import type { StructureCluster } from '../../lib/bridge'
import type { Graph3DEngine } from '../Graph3DEngine'
import type { GraphFiltersState } from '../viewPrefs'
import { flyCameraToNode } from '../../ui/constellationFlyTo'

export type StructureNavMode = 'workspace' | 'folder' | 'topic'

export interface StructureNavSelection {
  mode: StructureNavMode
  key: string
  label: string
}

const CAMERA_ANIM_MS = 900

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/$/, '')
}

export function filtersForCluster(
  mode: StructureNavMode,
  item: StructureCluster,
): Partial<GraphFiltersState> {
  if (mode === 'workspace') {
    return { workspaces: [item.key], topics: null, folders: null }
  }
  if (mode === 'topic') {
    return { workspaces: null, topics: [item.key], folders: null }
  }
  const folderKey = normalizePath(item.key)
  const workspace = folderKey.split('/')[0] || null
  return {
    workspaces: workspace ? [workspace] : null,
    topics: null,
    folders: [folderKey],
  }
}

export function clearStructureNavFilters(): Partial<GraphFiltersState> {
  return { workspaces: null, topics: null, folders: null }
}

export function flyToCluster(
  forceGraph: {
    graphData(): { nodes: Array<Record<string, unknown>> }
    cameraPosition(
      to: { x: number; y: number; z: number },
      lookAt?: { x: number; y: number; z: number } | Record<string, unknown> | null,
      duration?: number,
    ): unknown
  },
  engine: Graph3DEngine | null,
  item: StructureCluster,
): boolean {
  for (const id of item.sample_node_ids || []) {
    if (flyCameraToNode(forceGraph, id)) return true
  }

  const nodes = forceGraph.graphData().nodes.filter((node) => (
  engine ? engine.isNodeGraphVisible(node) : true
  ))
  if (nodes.length) {
    let sx = 0
    let sy = 0
    let sz = 0
    for (const node of nodes) {
      sx += (node.x as number) || 0
      sy += (node.y as number) || 0
      sz += (node.z as number) || 0
    }
    const cx = sx / nodes.length
    const cy = sy / nodes.length
    const cz = sz / nodes.length
    const dist = 120
    const hyp = Math.hypot(cx, cy, cz) || 1
    const ratio = 1 + dist / hyp
    forceGraph.cameraPosition(
      { x: cx * ratio, y: cy * ratio, z: cz * ratio },
      { x: cx, y: cy, z: cz },
      CAMERA_ANIM_MS,
    )
    return true
  }

  const centroid = item.centroid
  if (centroid && ('x' in centroid || 'y' in centroid)) {
    const cx = Number(centroid.x) || 0
    const cy = Number(centroid.y) || 0
    const cz = 0
    const dist = 140
    const hyp = Math.hypot(cx, cy, cz) || 1
    const ratio = 1 + dist / hyp
    forceGraph.cameraPosition(
      { x: cx * ratio, y: cy * ratio, z: cz * ratio + dist * 0.35 },
      { x: cx, y: cy, z: cz },
      CAMERA_ANIM_MS,
    )
    return true
  }

  return false
}

export function structureNavLabel(
  mode: StructureNavMode,
  item: StructureCluster,
): string {
  const name = item.label || item.key
  if (mode === 'workspace') return `Workspace: ${name}`
  if (mode === 'topic') return `Topic: ${name.replace(/_/g, ' ')}`
  return `Carpeta: ${name}`
}
