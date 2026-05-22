/**
 * renderOptimizations.ts
 *
 * Pure TypeScript helpers for adaptive rendering + progressive graph streaming,
 * ported and adapted from Graphium.
 */

export interface RenderProfile {
  antialias: boolean
  nodeSegments: number
  starCount: number
  warmupTicks: number
  cooldownTicks: number
  initialBatchSize: number
  batchSize: number
  chunkDelay: number
  minimapStride: number
}

const TYPE_PRIORITY: Record<string, number> = {
  folder: 0,
  project: 1,
  research: 2,
  concept: 3,
  index: 4,
  document: 5,
  typescript: 6,
  javascript: 7,
  config: 8,
  text: 9,
  tag: 10,
  file: 11,
  default: 12,
}

function normalizeNodeId(value: unknown): string | null {
  if (value && typeof value === 'object') {
    return (value as { id: string }).id
  }
  if (typeof value === 'string') return value
  return null
}

function normalizeLinkKey(link: { source: unknown; target: unknown; type?: string }): string {
  const source = normalizeNodeId(link.source)
  const target = normalizeNodeId(link.target)
  const type = link.type || 'link'
  return `${source}→${target}::${type}`
}

function countDegrees(nodes: Array<{ id: string }>, links: Array<{ source: unknown; target: unknown }>): Map<string, number> {
  const degree = new Map<string, number>()
  for (const node of nodes || []) {
    degree.set(node.id, 0)
  }
  for (const link of links || []) {
    const source = normalizeNodeId(link.source)
    const target = normalizeNodeId(link.target)
    if (source != null) degree.set(source, (degree.get(source) || 0) + 1)
    if (target != null) degree.set(target, (degree.get(target) || 0) + 1)
  }
  return degree
}

function getTypePriority(type: string): number {
  return TYPE_PRIORITY[type] ?? TYPE_PRIORITY.default
}

export function getRenderProfile(nodeCount: number): RenderProfile {
  const isLarge = nodeCount >= 1000
  const isMedium = nodeCount >= 400
  const isSmall = nodeCount < 150

  if (isSmall) {
    return {
      antialias: true,
      nodeSegments: 8,
      starCount: 1500,
      warmupTicks: 15,
      cooldownTicks: 25,
      initialBatchSize: nodeCount,
      batchSize: nodeCount,
      chunkDelay: 0,
      minimapStride: 15,
    }
  }

  if (isLarge) {
    return {
      antialias: false,
      nodeSegments: 4,
      starCount: 600,
      warmupTicks: 8,
      cooldownTicks: 12,
      initialBatchSize: Math.min(80, Math.max(50, Math.round(nodeCount * 0.06))),
      batchSize: Math.min(100, Math.max(60, Math.round(nodeCount * 0.05))),
      chunkDelay: 16,
      minimapStride: 35,
    }
  }

  if (isMedium) {
    return {
      antialias: false,
      nodeSegments: 5,
      starCount: 900,
      warmupTicks: 12,
      cooldownTicks: 18,
      initialBatchSize: Math.min(120, Math.max(80, Math.round(nodeCount * 0.15))),
      batchSize: Math.min(130, Math.max(70, Math.round(nodeCount * 0.08))),
      chunkDelay: 12,
      minimapStride: 25,
    }
  }

  return {
    antialias: false,
    nodeSegments: 6,
    starCount: 1000,
    warmupTicks: 12,
    cooldownTicks: 18,
    initialBatchSize: Math.min(120, Math.max(80, Math.round(nodeCount * 0.15))),
    batchSize: Math.min(130, Math.max(70, Math.round(nodeCount * 0.08))),
    chunkDelay: 12,
    minimapStride: 25,
  }
}

export interface GraphBounds3D {
  center: { x: number; y: number; z: number }
  radius: number
}

type NodeWithCoords = {
  x?: number
  y?: number
  z?: number
  position?: { x?: number; y?: number; z?: number }
}

function nodeCoords(n: NodeWithCoords): { x: number; y: number; z: number } {
  const pos = n.position
  return {
    x: typeof n.x === 'number' ? n.x : (typeof pos?.x === 'number' ? pos.x : 0),
    y: typeof n.y === 'number' ? n.y : (typeof pos?.y === 'number' ? pos.y : 0),
    z: typeof n.z === 'number' ? n.z : (typeof pos?.z === 'number' ? pos.z : 0),
  }
}

/** Axis-aligned bounds + bounding-sphere radius from node coordinates. */
export function computeGraphBounds3D(
  nodes: NodeWithCoords[],
  fallbackRadius = 800,
): GraphBounds3D {
  if (!nodes?.length) {
    return { center: { x: 0, y: 0, z: 0 }, radius: fallbackRadius }
  }

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const n of nodes) {
    const { x, y, z } = nodeCoords(n)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }

  if (!Number.isFinite(minX)) {
    return { center: { x: 0, y: 0, z: 0 }, radius: fallbackRadius }
  }

  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  }

  const halfDiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2
  let maxDist = halfDiag
  for (const n of nodes) {
    const { x, y, z } = nodeCoords(n)
    const d = Math.hypot(x - center.x, y - center.y, z - center.z)
    if (d > maxDist) maxDist = d
  }

  const radius = Math.max(120, maxDist || fallbackRadius)
  return { center, radius }
}

export interface StarfieldConfig {
  count: number
  center: { x: number; y: number; z: number }
  outerRadius: number
  pointSize: number
}

const STARFIELD_MIN_OUTER_RADIUS = 650
const STARFIELD_RADIUS_MARGIN = 1.5

/** Star count and point size scale with graph extent so the backdrop fills the scene. */
export function buildStarfieldConfig(
  bounds: GraphBounds3D,
  baseStarCount: number,
): StarfieldConfig {
  const outerRadius = Math.max(
    STARFIELD_MIN_OUTER_RADIUS,
    bounds.radius * STARFIELD_RADIUS_MARGIN,
  )
  const extentScale = outerRadius / 800
  const count = Math.min(
    2800,
    Math.round(baseStarCount * Math.max(1, Math.min(2.2, extentScale ** 0.65))),
  )
  // Screen-space px; gentle growth so large graphs stay subtle (was /220, too bold)
  const pointSize = Math.min(3.2, Math.max(1.1, outerRadius / 520))

  return {
    count,
    center: bounds.center,
    outerRadius,
    pointSize,
  }
}

function isVaultImportNode(node: { id?: string; path?: string }): boolean {
  const blob = `${node.id || ''} ${node.path || ''}`.toLowerCase()
  return (
    blob.includes('/imports/github/')
    || blob.includes('/imports/arxiv/')
    || blob.includes('/imports/pubmed/')
  )
}

export function buildRenderOrder(nodes: any[], links: any[]): any[] {
  const degree = countDegrees(nodes, links)
  return [...(nodes || [])].sort((a, b) => {
    const importDelta = (isVaultImportNode(a) ? 0 : 1) - (isVaultImportNode(b) ? 0 : 1)
    if (importDelta !== 0) return importDelta

    const typeDelta = getTypePriority(a.type) - getTypePriority(b.type)
    if (typeDelta !== 0) return typeDelta

    const degreeDelta = (degree.get(b.id) || 0) - (degree.get(a.id) || 0)
    if (degreeDelta !== 0) return degreeDelta

    const weightDelta = (b.weight || 0) - (a.weight || 0)
    if (weightDelta !== 0) return weightDelta

    const aName = (a.name || a.label || a.id || '').toString()
    const bName = (b.name || b.label || b.id || '').toString()
    return aName.localeCompare(bName)
  })
}

export interface ProgressiveLoaderResult {
  data: { nodes: any[]; links: any[] }
  nodesAdded: number
  linksAdded: number
  loadedNodes: number
  loadedLinks: number
  totalNodes: number
  totalLinks: number
  done: boolean
}

export function createProgressiveLoader(graphData: { nodes: any[]; links: any[] }) {
  const nodes = buildRenderOrder(graphData.nodes || [], graphData.links || [])
  const links = [...(graphData.links || [])]
  const loadedNodeIds = new Set<string>()
  const addedLinkKeys = new Set<string>()
  const linksByNodeId = new Map<string, any[]>()

  for (const link of links) {
    const source = normalizeNodeId(link.source)
    const target = normalizeNodeId(link.target)
    for (const id of [source, target]) {
      if (id == null) continue
      if (!linksByNodeId.has(id)) linksByNodeId.set(id, [])
      linksByNodeId.get(id)!.push(link)
    }
  }

  const data = { nodes: [] as any[], links: [] as any[] }
  let cursor = 0

  function append(count: number): ProgressiveLoaderResult {
    const batch = nodes.slice(cursor, cursor + count)
    cursor += batch.length
    for (const node of batch) {
      loadedNodeIds.add(node.id)
      data.nodes.push(node)
    }

    const touchedLinks: any[] = []
    for (const node of batch) {
      const incident = linksByNodeId.get(node.id) || []
      for (const link of incident) {
        const source = normalizeNodeId(link.source)
        const target = normalizeNodeId(link.target)
        if (source == null || target == null) continue
        if (!loadedNodeIds.has(source) || !loadedNodeIds.has(target)) continue
        const key = normalizeLinkKey(link)
        if (addedLinkKeys.has(key)) continue
        addedLinkKeys.add(key)
        data.links.push(link)
        touchedLinks.push(link)
      }
    }

    return {
      data,
      nodesAdded: batch.length,
      linksAdded: touchedLinks.length,
      loadedNodes: data.nodes.length,
      loadedLinks: data.links.length,
      totalNodes: nodes.length,
      totalLinks: links.length,
      done: cursor >= nodes.length,
    }
  }

  return {
    data,
    append,
    totalNodes: nodes.length,
    totalLinks: links.length,
  }
}
