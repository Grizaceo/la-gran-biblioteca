// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import type { Node, Edge, Graph } from '../lib/bridge'
import type { ConstellationFigure } from '../lib/api/types'
import { PALETTE } from './palette.js'
import { buildFiguresGroup, disposeFiguresGroup } from './constellationFigures'
import {
  getRenderProfile,
  createProgressiveLoader,
  computeGraphBounds3D,
  buildStarfieldConfig,
  type RenderProfile,
  type StarfieldConfig,
} from './renderOptimizations'
import {
  getNodeWorkspace as resolveNodeWorkspace,
  isLinkGraphVisible,
  isNodeGraphVisible,
  mergeImportsIntoWorkspaceFilter,
} from './graphFilters'
import { applyLayoutForces, hydrateNodeForLayout } from './layoutMode'
import {
  type GraphFiltersState,
  type QualityPreset,
  type LayoutMode,
  type HeatmapMode,
  DEFAULT_GRAPH_FILTERS,
  loadGraphFilters,
  getLayoutMode,
  getHeatmapMode,
} from './viewPrefs'

export type { GraphFiltersState }

export interface LoadProgress {
  loaded: number
  total: number
}

// Caches for GPU/Three.js resources to prevent duplicate allocation and memory thrashing
const sphereGeoCache = new Map<string, THREE.SphereGeometry>()
const ringGeoCache = new Map<string, THREE.RingGeometry>()
const lambertMatCache = new Map<string, THREE.MeshLambertMaterial>()
const basicMatCache = new Map<string, THREE.MeshBasicMaterial>()
const ringMatCache = new Map<string, THREE.MeshBasicMaterial>()

const PARTICLE_RADIUS = 280

function getSphereGeo(radius: number, segments: number): THREE.SphereGeometry {
  const bucketRadius = Math.max(0.5, Math.round(radius * 10) / 10)
  const key = `${bucketRadius.toFixed(1)}_${segments}`
  if (!sphereGeoCache.has(key)) {
    sphereGeoCache.set(key, new THREE.SphereGeometry(bucketRadius, segments, segments))
  }
  return sphereGeoCache.get(key)!
}

function getRingGeo(inner: number, outer: number, segments: number): THREE.RingGeometry {
  const key = `${inner.toFixed(1)}_${outer.toFixed(1)}_${segments}`
  if (!ringGeoCache.has(key)) {
    ringGeoCache.set(key, new THREE.RingGeometry(inner, outer, segments))
  }
  return ringGeoCache.get(key)!
}

function getLambertMat(type: string): THREE.MeshLambertMaterial {
  if (!lambertMatCache.has(type)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    lambertMatCache.set(type, new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.85,
    }))
  }
  return lambertMatCache.get(type)!
}

function getBasicMat(type: string): THREE.MeshBasicMaterial {
  if (!basicMatCache.has(type)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    basicMatCache.set(type, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.7,
    }))
  }
  return basicMatCache.get(type)!
}

function getLowBasicMat(type: string): THREE.MeshBasicMaterial {
  const key = `${type}_low`
  if (!basicMatCache.has(key)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    basicMatCache.set(key, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.45,
    }))
  }
  return basicMatCache.get(key)!
}

function getRingMat(type: string): THREE.MeshBasicMaterial {
  if (!ringMatCache.has(type)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    ringMatCache.set(type, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
    }))
  }
  return ringMatCache.get(type)!
}

function nodeSize(weight: number): number {
  return Math.min(Math.cbrt(weight || 1) * 3, 22)
}

function volumeNodeSize(degree: number, childCount: number): number {
  const hub = degree + childCount * 0.5
  return Math.min(4 + Math.sqrt(hub) * 2.2, 24)
}

function studyNodeSize(base: number, studyCount: number): number {
  const boost = studyCount > 0 ? 1 + Math.min(studyCount, 8) * 0.15 : 1
  return Math.min(base * boost, 26)
}

function heatmapStudyColor(score: number, maxScore: number): THREE.Color {
  const t = maxScore > 0 ? Math.min(1, score / maxScore) : 0
  const cold = new THREE.Color(0x4fc3f7)
  const warm = new THREE.Color(0xff7043)
  return cold.clone().lerp(warm, t)
}

function heatmapVolumeColor(degree: number, maxDegree: number): THREE.Color {
  const t = maxDegree > 0 ? Math.min(1, degree / maxDegree) : 0
  const low = new THREE.Color(0x5c6bc0)
  const high = new THREE.Color(0xffee58)
  return low.clone().lerp(high, t)
}

function computeDegree(edges: Edge[]): Map<string, number> {
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) || 0) + 1)
    deg.set(e.target, (deg.get(e.target) || 0) + 1)
  }
  return deg
}

// Starfield background — fills the graph bounding volume (adapted from Graphium/SAIR)
function createStarfield(scene: THREE.Scene, config: StarfieldConfig): THREE.Points {
  const { count, center, outerRadius, pointSize } = config
  const starsGeo = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    // Uniform volume distribution inside the sphere that wraps the graph
    const r = outerRadius * Math.cbrt(Math.random())

    positions[i * 3] = center.x + r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = center.y + r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = center.z + r * Math.cos(phi)

    const brightness = 0.45 + Math.random() * 0.55
    colors[i * 3] = 0.8 * brightness
    colors[i * 3 + 1] = 0.9 * brightness
    colors[i * 3 + 2] = 1.0 * brightness
  }

  starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const starsMat = new THREE.PointsMaterial({
    size: pointSize,
    sizeAttenuation: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.62,
  })

  const starfield = new THREE.Points(starsGeo, starsMat)
  scene.add(starfield)
  return starfield
}

function resolveType(endpoint: unknown): string {
  if (typeof endpoint === 'object' && endpoint !== null) {
    return ((endpoint as Record<string, unknown>).type as string) || 'default'
  }
  return 'default'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Graph3DEngine {
  fg: any
  onMinimapTick?: () => void
  onStop?: () => void
  onTypesChanged?: () => void

  public starfieldRotationEnabled = true
  public photonsEnabled = true
  public showLabels = false
  public minimapStride = 1
  public qualityPreset: QualityPreset = 'auto'
  public layoutMode: LayoutMode = getLayoutMode()

  onLoadProgress?: (p: LoadProgress) => void
  private _savedLinkStrength = 1
  private _savedChargeStrength = -60

  private nodeIndex = new Map<string, Record<string, unknown>>()
  private workspaceRoot = ''
  private graphFilters: GraphFiltersState = { ...DEFAULT_GRAPH_FILTERS }
  private _lodSegHi = 10
  private _lodSegMid = 7
  private _lodSegLow = 4
  private _inFocusMode = false
  private starfield: THREE.Points
  private _starfieldOuterRadius = 0
  private hiddenTypes = new Set<string>()
  private _zoomOnStop = false
  private _rafId = 0
  private _rafFrame = 0
  private _lastCamPos = new THREE.Vector3()
  private _lastLodCamPos = new THREE.Vector3()
  private _lodCamPos = new THREE.Vector3()
  private _lodNodePos = new THREE.Vector3()
  private _paused = false
  private _savedParticles = 2
  private _savedStarfieldRotation = true
  private _savedPhotonsEnabled = true
  private _savedCooldownTicks = 0
  private _figuresGroup: THREE.Group | null = null
  private _tick!: () => void
  private _lodNodeCount = 0
  private _progressivePump: (() => void) | null = null
  private _apiGraph: Graph | null = null
  pendingFocusQueue: string[] = []
  heatmapMode: HeatmapMode = getHeatmapMode()
  private highlightNodeIds = new Set<string>()
  private _highlightMeshes: THREE.Object3D[] = []
  private _heatmapStats = { maxStudyScore: 1, maxDegree: 1 }

  constructor(container: HTMLElement) {
    const bootProfile = getRenderProfile(400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FG3D = ForceGraph3D as any
    this.fg = FG3D({
      controlType: 'orbit',
      rendererConfig: { antialias: bootProfile.antialias, alpha: false },
    })(container)
      .nodeLabel((node: Record<string, unknown>) =>
        this.showLabels ? String(node.name || node.label || node.id || '') : '')
      .nodeThreeObject((node: Record<string, unknown>) => {
        const size = this._nodeDisplaySize(node)
        const type = (node.type as string) || 'default'
        
        // Multi-level LOD Group representation
        const group = new THREE.Group()
        group.userData = { _lodDistance: size }

        // HI-LOD: Lambert lighting, configurable segments, glow ring
        const hiMesh = new THREE.Mesh(getSphereGeo(size, this._lodSegHi), getLambertMat(type))
        hiMesh.name = 'lod_hi'

        const ringGeo = getRingGeo(size - 0.5, size + 0.5, 24)
        const ring = new THREE.Mesh(ringGeo, getRingMat(type))
        ring.lookAt(new THREE.Vector3(0, 0, 1))
        ring.name = 'lod_ring'
        hiMesh.add(ring)
        group.add(hiMesh)

        // MID-LOD: Basic lighting (faster!), 7 segments, no ring
        const midMesh = new THREE.Mesh(getSphereGeo(size, this._lodSegMid), getBasicMat(type))
        midMesh.name = 'lod_mid'
        midMesh.visible = false
        group.add(midMesh)

        // LOW-LOD: Basic lighting, fewer segments, no ring
        const lowMesh = new THREE.Mesh(getSphereGeo(size, this._lodSegLow), getLowBasicMat(type))
        lowMesh.name = 'lod_low'
        lowMesh.visible = false
        group.add(lowMesh)

        return group
      })
      .nodeThreeObjectExtend(false)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleWidth(1.2)
      .linkDirectionalArrowLength(6)
      .linkDirectionalArrowRelPos(0.95)
      .linkResolution(4)
      .warmupTicks(120)
      .cooldownTicks(0)
      .backgroundColor('#000011')
      .linkColor((link: Record<string, unknown>) => {
        const type = (link.type as string) || 'default'
        return (PALETTE as Record<string, string>)[type] ?? PALETTE.default
      })
      .linkOpacity(0.7)

    const scene = this.fg.scene()
    const bootConfig = buildStarfieldConfig(
      computeGraphBounds3D([]),
      bootProfile.starCount,
    )
    this.starfield = createStarfield(scene, bootConfig)
    scene.add(new THREE.AmbientLight(0x404060, 0.6))
    scene.add(new THREE.PointLight(0xffffff, 0.9, 1200))

    this.fg.onEngineStop(() => {
      if (this._zoomOnStop) {
        this.fg.zoomToFit(1000, 40)
        this._zoomOnStop = false
        const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
        if (nodes?.length) {
          this._rebuildStarfield(nodes, this.getEffectiveProfile(nodes.length))
        }
      }
      try { this.onStop?.() } catch (_) { /* */ }
      setTimeout(() => {
        try { this.onTypesChanged?.() } catch (_) { /* */ }
      }, 0)
    })

    let minimapFrame = 0
    this.fg.onEngineTick(() => {
      if (++minimapFrame % 30 === 0) this.onMinimapTick?.()
    })

    // rAF loop: starfield rotation + throttled updates for LOD and link particles
    this._tick = () => {
      this._rafId = requestAnimationFrame(this._tick)
      try {
        if (this.starfieldRotationEnabled) {
          this.starfield.rotation.y += 0.0001
          this.starfield.rotation.x += 0.00005
        }
        
        // Throttled CPU tasks (run every 6 frames ~ 100ms)
        if (++this._rafFrame % 6 === 0) {
          this.updateParticleVisibility()
          this.updateLOD()
        }
      } catch (_) { /* swallow — loop must survive */ }
    }
    this._rafId = requestAnimationFrame(this._tick)
  }

  // Camera distance-driven level of detail selection (HI, MID, LOW meshes)
  private updateLOD(): void {
    const camera: THREE.Camera = this.fg.camera()
    if (!camera) return
    const camPos = camera.position

    // Skip when camera is still — avoids O(N) JS loop for nothing
    if (camPos.distanceToSquared(this._lastLodCamPos) < 1) return
    this._lastLodCamPos.copy(camPos)

    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    if (!nodes?.length) return

    this._lodCamPos.copy(camPos)

    // Thresholds are normalized by node size, so compare normDist² to avoid sqrt
    const LOD_NEAR = 150
    const LOD_MID = 400
    const stride = this._lodNodeCount >= 400
      ? Math.max(1, Math.ceil(nodes.length / 200))
      : 1

    for (let i = 0; i < nodes.length; i += stride) {
      const n = nodes[i]
      const obj = n.__threeObj as THREE.Group | undefined
      if (!obj || !obj.isGroup) continue

      this._lodNodePos.set((n.x as number) || 0, (n.y as number) || 0, (n.z as number) || 0)
      const distSq = this._lodCamPos.distanceToSquared(this._lodNodePos)
      const size = Math.max((obj.userData._lodDistance as number) || 3, 1)
      const normDist = Math.sqrt(distSq) / size

      const hi = obj.getObjectByName('lod_hi')
      const mid = obj.getObjectByName('lod_mid')
      const low = obj.getObjectByName('lod_low')

      if (normDist < LOD_NEAR) {
        if (hi) hi.visible = true
        if (mid) mid.visible = false
        if (low) low.visible = false
      } else if (normDist < LOD_MID) {
        if (hi) hi.visible = false
        if (mid) mid.visible = true
        if (low) low.visible = false
      } else {
        if (hi) hi.visible = false
        if (mid) mid.visible = false
        if (low) low.visible = true
      }
    }
  }

  private updateParticleVisibility(): void {
    const camera: THREE.Camera = this.fg.camera()
    if (!camera) return
    const camPos = camera.position

    if (camPos.distanceToSquared(this._lastCamPos) < 1) return
    this._lastCamPos.copy(camPos)

    const radiusSq = PARTICLE_RADIUS * PARTICLE_RADIUS
    const { links } = this.fg.graphData() as { links: Record<string, unknown>[] }
    if (!links?.length) return

    for (const link of links) {
      const src = link.source as Record<string, unknown>
      const tgt = link.target as Record<string, unknown>
      if (!src || !tgt || typeof src !== 'object' || typeof tgt !== 'object') continue

      const mx = (((src.x as number) || 0) + ((tgt.x as number) || 0)) / 2
      const my = (((src.y as number) || 0) + ((tgt.y as number) || 0)) / 2
      const mz = (((src.z as number) || 0) + ((tgt.z as number) || 0)) / 2
      const dx = mx - camPos.x
      const dy = my - camPos.y
      const dz = mz - camPos.z
      const distSq = dx * dx + dy * dy + dz * dz

      const linkVisible =
        this.isLinkGraphVisible(link) && link.__filterVisible !== false

      // photons are stored internally by 3d-force-graph; access via __photonsObj if present
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const photons = (link as any).__photonsObj as THREE.Object3D | undefined
      if (photons) {
        photons.visible = Boolean(
          this.photonsEnabled && linkVisible && distSq < radiusSq,
        )
      }
    }
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
  }

  getGraphFilters(): GraphFiltersState {
    return { ...this.graphFilters, hiddenEdgeTypes: [...this.graphFilters.hiddenEdgeTypes] }
  }

  setGraphFilters(partial: Partial<GraphFiltersState>): void {
    this.graphFilters = {
      ...this.graphFilters,
      ...partial,
      hiddenEdgeTypes: partial.hiddenEdgeTypes
        ? [...partial.hiddenEdgeTypes]
        : this.graphFilters.hiddenEdgeTypes,
    }
    if (!this._inFocusMode) {
      this.refreshVisibility()
      if (partial.workspaces !== undefined
        || partial.topics !== undefined
        || partial.folders !== undefined
        || partial.studyFilter !== undefined
        || partial.minDegree !== undefined) {
        this._recomputeHeatmapStats()
        this.refreshHeatmapAppearance()
      }
    }
  }

  getWorkspaceList(): string[] {
    const ws = new Set<string>()
    for (const node of this.nodeIndex.values()) {
      const w = this.getNodeWorkspace(node)
      if (w) ws.add(w)
    }
    return Array.from(ws).sort()
  }

  getNodeWorkspace(node: Record<string, unknown>): string {
    return resolveNodeWorkspace(node, this.workspaceRoot)
  }

  /** Show vault imports when workspace filters hide everything except e.g. lexo. */
  ensureImportsWorkspaceVisible(): void {
    const patch = mergeImportsIntoWorkspaceFilter(
      this.graphFilters,
      this.getWorkspaceList(),
    )
    if (Object.keys(patch).length) this.setGraphFilters(patch)
  }

  private _wsFn = (node: Record<string, unknown>) => this.getNodeWorkspace(node)

  isNodeGraphVisible(node: Record<string, unknown>): boolean {
    return isNodeGraphVisible(
      node,
      this.graphFilters,
      this.hiddenTypes,
      this._wsFn,
    )
  }

  isLinkGraphVisible(link: Record<string, unknown>): boolean {
    return isLinkGraphVisible(
      link,
      this.graphFilters,
      this.hiddenTypes,
      this._wsFn,
    )
  }

  enqueuePendingFocus(path: string): void {
    this.pendingFocusQueue.push(path)
  }

  setPendingFocusQueue(paths: string[]): void {
    this.pendingFocusQueue = paths
  }

  drainPendingFocusQueue(
    updated: Graph,
    hooks: {
      selectNode: (id: string, delay?: number) => Promise<void>
      addActivityLog?: (msg: string, type?: string) => void
    },
  ): string[] {
    const remaining: string[] = []
    for (const rawPath of this.pendingFocusQueue) {
      const targetPath = rawPath.replace(/\\/g, '/').toLowerCase()
      const cleanTarget = targetPath.replace(/^\/+|\/+$/g, '')
      const fileStem = cleanTarget.split('/').pop() || cleanTarget
      const matchedNode = updated.nodes.find((node) => {
        const nodePath = (node.path || '').replace(/\\/g, '/').toLowerCase()
        const cleanNode = nodePath.replace(/^\/+|\/+$/g, '')
        const nodeId = (node.id || '').replace(/\\/g, '/').toLowerCase()
        return (
          cleanNode === cleanTarget
          || cleanNode.endsWith('/' + cleanTarget)
          || cleanNode.endsWith(cleanTarget)
          || cleanTarget.endsWith(cleanNode)
          || nodeId === cleanTarget
          || nodeId.endsWith('/' + cleanTarget)
          || nodeId.endsWith(cleanTarget)
          || (fileStem.length > 4
            && (cleanNode.includes(fileStem) || nodeId.includes(fileStem)))
        )
      })
      if (matchedNode) {
        if (rawPath.toLowerCase().includes('imports/')) {
          this.ensureImportsWorkspaceVisible()
          this.refreshVisibility()
        }
        hooks.addActivityLog?.(
          `Enfocando nuevo elemento importado: ${matchedNode.label} [${matchedNode.type}]`,
          'success',
        )
        hooks.selectNode(matchedNode.id, 950).catch((err) => {
          console.error('Error auto-selecting node:', err)
        })
      } else {
        remaining.push(rawPath)
      }
    }
    return remaining
  }

  setFocusMode(active: boolean): void {
    this._inFocusMode = active
    if (!active) this.refreshVisibility()
  }

  setHeatmapMode(mode: HeatmapMode): void {
    this.heatmapMode = mode
    this._recomputeHeatmapStats()
    this.refreshHeatmapAppearance()
    this.refreshVisibility()
  }

  getHeatmapMode(): HeatmapMode {
    return this.heatmapMode
  }

  setHighlightNodeIds(ids: string[] | null | undefined): void {
    this.highlightNodeIds = new Set(ids || [])
    this._refreshHighlights()
  }

  private _nodeDisplaySize(node: Record<string, unknown>): number {
    const meta = (node.metadata as Record<string, unknown>) || {}
    const degree = Number(node.degree) || Number(meta.degree_hint) || 0
    const childCount = Number(meta.child_count) || 0
    const studyCount = Number(meta.study_count) || 0
    const base = nodeSize(node.weight as number)

    if (this.heatmapMode === 'volume') {
      return volumeNodeSize(degree, childCount)
    }
    if (this.heatmapMode === 'study') {
      return studyNodeSize(base, studyCount)
    }
    return base
  }

  private _recomputeHeatmapStats(): void {
    let maxStudyScore = 1
    let maxDegree = 1
    for (const node of this.nodeIndex.values()) {
      const meta = (node.metadata as Record<string, unknown>) || {}
      maxStudyScore = Math.max(maxStudyScore, Number(meta.study_score) || 0)
      maxDegree = Math.max(maxDegree, Number(node.degree) || 0)
    }
    this._heatmapStats = { maxStudyScore, maxDegree }
  }

  private _setMeshColor(mesh: THREE.Mesh, color: THREE.Color, opacity: number): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshBasicMaterial) {
        mat.color.copy(color)
        if ('emissive' in mat && mat.emissive) {
          mat.emissive.copy(color)
        }
        mat.transparent = true
        mat.opacity = opacity
        mat.needsUpdate = true
      }
    }
  }

  private _applyNodeVisual(node: Record<string, unknown>, passesFilter: boolean): void {
    const obj = node.__threeObj as THREE.Group | undefined
    if (!obj || !obj.isGroup) return

    const meta = (node.metadata as Record<string, unknown>) || {}
    const type = (node.type as string) || 'default'
    const paletteColor = new THREE.Color(
      (PALETTE as Record<string, string>)[type] ?? PALETTE.default,
    )
    let color = paletteColor
    let opacity = passesFilter ? 0.85 : 0.14

    if (this.heatmapMode === 'study') {
      color = heatmapStudyColor(
        Number(meta.study_score) || 0,
        this._heatmapStats.maxStudyScore,
      )
      opacity = passesFilter ? 0.9 : 0.12
    } else if (this.heatmapMode === 'volume') {
      color = heatmapVolumeColor(
        Number(node.degree) || 0,
        this._heatmapStats.maxDegree,
      )
      opacity = passesFilter ? 0.88 : 0.12
    } else if (!passesFilter) {
      opacity = 0.14
    }

    const size = this._nodeDisplaySize(node)
    obj.userData._lodDistance = size
    obj.scale.set(1, 1, 1)

    for (const name of ['lod_hi', 'lod_mid', 'lod_low']) {
      const mesh = obj.getObjectByName(name) as THREE.Mesh | undefined
      if (!mesh) continue
      const baseOpacity = name === 'lod_low' ? 0.45 : name === 'lod_mid' ? 0.7 : 0.85
      this._setMeshColor(mesh, color, opacity * baseOpacity)
    }
    const ring = obj.getObjectByName('lod_ring') as THREE.Mesh | undefined
    if (ring) {
      this._setMeshColor(ring, color, passesFilter ? 0.25 : 0.08)
    }
  }

  refreshHeatmapAppearance(): void {
    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    if (!nodes?.length) return
    for (const node of nodes) {
      const passes = this.isNodeGraphVisible(node)
      this._applyNodeVisual(node, passes)
    }
    this._refreshHighlights()
  }

  private _clearHighlights(): void {
    for (const mesh of this._highlightMeshes) {
      if (mesh.parent) mesh.parent.remove(mesh)
      mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) obj.geometry.dispose()
      })
      const mat = mesh instanceof THREE.Mesh ? mesh.material : null
      if (mat && !Array.isArray(mat)) mat.dispose()
    }
    this._highlightMeshes = []
  }

  private _refreshHighlights(): void {
    this._clearHighlights()
    if (!this.highlightNodeIds.size) return

    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    for (const node of nodes) {
      if (!this.highlightNodeIds.has(String(node.id))) continue
      const original = node.__threeObj as THREE.Group | undefined
      if (!original?.parent) continue
      const highlightMesh = original.clone()
      highlightMesh.scale.set(2.2, 2.2, 2.2)
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        wireframe: true,
      })
      highlightMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = mat
      })
      original.parent.add(highlightMesh)
      this._highlightMeshes.push(highlightMesh)
    }
  }

  flyToNode(nodeId: string, duration = 1000): boolean {
    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return false
    const distance = 150
    const distRatio = 1 + distance / Math.max(1, Math.hypot(
      (node.x as number) || 0,
      (node.y as number) || 0,
      (node.z as number) || 0,
    ))
    this.fg.cameraPosition(
      {
        x: ((node.x as number) || 0) * distRatio,
        y: ((node.y as number) || 0) * distRatio,
        z: ((node.z as number) || 0) * distRatio,
      },
      node,
      duration,
    )
    return true
  }

  refreshVisibility(): void {
    const { nodes, links } = this.fg.graphData() as {
      nodes: Record<string, unknown>[]
      links: Record<string, unknown>[]
    }
    for (const n of nodes) {
      const visible = this.isNodeGraphVisible(n)
      n.__filterVisible = visible
      if (!this._inFocusMode) {
        const obj = n.__threeObj as THREE.Object3D | undefined
        if (obj) {
          obj.visible = true
          this._applyNodeVisual(n, visible)
        }
      }
    }
    for (const link of links) {
      const src = link.source as Record<string, unknown>
      const tgt = link.target as Record<string, unknown>
      const srcOk = src && typeof src === 'object' && (src.__filterVisible !== false)
      const tgtOk = tgt && typeof tgt === 'object' && (tgt.__filterVisible !== false)
      const passes = this.isLinkGraphVisible(link) && srcOk && tgtOk
      link.__filterVisible = passes
      if (!this._inFocusMode) {
        const lineObj = link.__lineObj as THREE.Object3D | undefined
        const arrowObj = link.__arrowObj as THREE.Object3D | undefined
        if (lineObj) {
          lineObj.visible = true
          lineObj.traverse((child) => {
            if (child instanceof THREE.Line && child.material) {
              const m = child.material as THREE.Material
              m.transparent = true
              ;(m as THREE.LineBasicMaterial).opacity = passes ? 0.7 : 0.08
            }
          })
        }
        if (arrowObj) arrowObj.visible = passes
      }
    }
    this.updateParticleVisibility()
    this._refreshHighlights()
  }

  setLayoutMode(mode: LayoutMode): void {
    this.layoutMode = mode
    if (mode !== 'constellation') this.setConstellationFigures(null)
    if (this._apiGraph) this.setGraph(this._apiGraph)
  }

  setConstellationFigures(figures: ConstellationFigure[] | null): void {
    const scene = this.fg.scene() as THREE.Scene
    if (this._figuresGroup) {
      scene.remove(this._figuresGroup)
      disposeFiguresGroup(this._figuresGroup)
      this._figuresGroup = null
    }
    if (figures?.length) {
      this._figuresGroup = buildFiguresGroup(figures)
      scene.add(this._figuresGroup)
    }
  }

  private getCurrentGraphSnapshot(): Graph | null {
    const { nodes, links } = this.fg.graphData() as {
      nodes: Record<string, unknown>[]
      links: Array<{ source: string; target: string; type?: string }>
    }
    if (!nodes?.length) return null
    const edges = links.map((l) => {
      const src = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source
      const tgt = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target
      return { source: src as string, target: tgt as string, type: (l.type as string) || 'default' }
    })
    const apiNodes = nodes.map((n) => {
      const meta = { ...(n.metadata as Record<string, unknown> || {}) }
      return {
        id: n.id as string,
        type: (n.type as string) || 'default',
        label: (n.label as string) || (n.name as string) || '',
        path: (n.path as string) || '',
        metadata: meta,
        position: {
          x: (n.x as number) || 0,
          y: (n.y as number) || 0,
          z: (n.z as number) || 0,
        },
      }
    }) as Node[]
    return { nodes: apiNodes, edges }
  }

  private _rebuildStarfield(
    nodes: Record<string, unknown>[],
    profile: RenderProfile,
    force = false,
  ): void {
    const bounds = computeGraphBounds3D(nodes)
    const delta = Math.abs(bounds.radius - this._starfieldOuterRadius) / Math.max(1, this._starfieldOuterRadius)
    if (!force && this.starfield && delta < 0.1) return

    this._starfieldOuterRadius = bounds.radius
    const config = buildStarfieldConfig(bounds, profile.starCount)
    const scene = this.fg.scene()
    if (this.starfield) {
      scene.remove(this.starfield)
      this.starfield.geometry.dispose()
      if (Array.isArray(this.starfield.material)) {
        this.starfield.material.forEach((m: THREE.Material) => m.dispose())
      } else {
        this.starfield.material.dispose()
      }
    }
    this.starfield = createStarfield(scene, config)
  }

  private _applyLayoutForces(profile: RenderProfile): void {
    const saved = applyLayoutForces(this.fg, this.layoutMode, profile, {
      linkStrength: this._savedLinkStrength,
      chargeStrength: this._savedChargeStrength,
    })
    this._savedLinkStrength = saved.linkStrength
    this._savedChargeStrength = saved.chargeStrength
  }

  setQualityPreset(preset: QualityPreset): void {
    this.qualityPreset = preset
    const nodeCount = this._lodNodeCount || 400
    const profile = this.getEffectiveProfile(nodeCount)
    this._lodSegHi = Math.max(4, profile.nodeSegments + 2)
    this._lodSegMid = Math.max(3, profile.nodeSegments)
    this._lodSegLow = Math.max(2, Math.floor(profile.nodeSegments * 0.6))
    this.minimapStride = profile.minimapStride
  }

  getEffectiveProfile(nodeCount: number): RenderProfile {
    if (this.qualityPreset === 'high') {
      return {
        ...getRenderProfile(Math.min(nodeCount, 149)),
        antialias: true,
        nodeSegments: 10,
        minimapStride: 10,
      }
    }
    if (this.qualityPreset === 'low') {
      return getRenderProfile(1500)
    }
    return getRenderProfile(nodeCount)
  }

  setShowLabels(show: boolean): void {
    this.showLabels = show
    this.fg.nodeLabel((node: Record<string, unknown>) =>
      show ? String(node.name || node.label || node.id || '') : '')
  }

  /**
   * Low-power mode while the detail panel is open: keeps the graph visible and
   * interactive but stops starfield rotation, link particles, and force simulation.
   */
  pause(): void {
    if (this._paused) return
    this._paused = true
    this._savedStarfieldRotation = this.starfieldRotationEnabled
    this._savedPhotonsEnabled = this.photonsEnabled
    this._savedParticles = this.photonsEnabled ? 2 : 0
    this._savedCooldownTicks = this.fg.cooldownTicks()

    this.starfieldRotationEnabled = false
    cancelAnimationFrame(this._rafId)
    this._rafId = 0
    this.fg.linkDirectionalParticles(0)
    this.fg.cooldownTicks(0)
  }

  resume(): void {
    if (!this._paused) return
    this._paused = false
    this.starfieldRotationEnabled = this._savedStarfieldRotation
    this.photonsEnabled = this._savedPhotonsEnabled
    this.fg.cooldownTicks(this._savedCooldownTicks)
    this.fg.linkDirectionalParticles(this.photonsEnabled ? this._savedParticles : 0)
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(this._tick)
    }
  }

  setPhotonsEnabled(enabled: boolean): void {
    this.photonsEnabled = enabled
    this._savedParticles = enabled ? 2 : 0
    if (!this._paused) {
      this.fg.linkDirectionalParticles(this._savedParticles)
    }
  }

  setTypeVisible(type: string, visible: boolean): void {
    if (visible) this.hiddenTypes.delete(type)
    else         this.hiddenTypes.add(type)
    if (!this._inFocusMode) this.refreshVisibility()
  }

  isTypeVisible(type: string): boolean {
    return !this.hiddenTypes.has(type)
  }

  getTypeStats(): Array<{ type: string; count: number; color: string }> {
    const counts = new Map<string, number>()
    for (const node of this.nodeIndex.values()) {
      const t = (node.type as string) || 'default'
      counts.set(t, (counts.get(t) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, count]) => ({
        type,
        count,
        color: (PALETTE as Record<string, string>)[type] ?? PALETTE.default,
      }))
  }

  setGraph(g: Graph): void {
    this._apiGraph = g
    this._progressivePump = null
    const degree = computeDegree(g.edges)
    this.nodeIndex.clear()
    
    const processedNodes = g.nodes.map(n => {
      const h = this.hydrate(n, degree.get(n.id) || 0)
      this.nodeIndex.set(n.id, h)
      return h
    })
    const processedLinks = g.edges.map((e: Edge) => ({ source: e.source, target: e.target, type: e.type }))

    const nodeCount = processedNodes.length
    this._lodNodeCount = nodeCount
    this.graphFilters = loadGraphFilters()
    this.heatmapMode = getHeatmapMode()
    this._recomputeHeatmapStats()
    const profile = this.getEffectiveProfile(nodeCount)
    this.minimapStride = profile.minimapStride
    this._lodSegHi = Math.max(4, profile.nodeSegments + 2)
    this._lodSegMid = Math.max(3, profile.nodeSegments)
    this._lodSegLow = Math.max(2, Math.floor(profile.nodeSegments * 0.6))

    this._applyLayoutForces(profile)
    this._rebuildStarfield(processedNodes, profile, true)

    // Optimize link geometry (Tube vs Simple Line) based on graph scale
    if (nodeCount >= 800) {
      this.fg.linkResolution(0) // Draw simple lines to save GPU draw calls
    } else {
      this.fg.linkResolution(6) // Glowing 3D tubular filaments
    }

    this._zoomOnStop = true

    // Progressive loading via chunk-based streaming
    const loader = createProgressiveLoader({ nodes: processedNodes, links: processedLinks })
    let result = loader.append(profile.initialBatchSize)
    this.fg.graphData({ nodes: result.data.nodes, links: result.data.links })

    this.onLoadProgress?.({ loaded: result.loadedNodes, total: result.totalNodes })

    let pumpFrame = 0
    const pump = () => {
      if (this._paused) return
      if (result.done) {
        this.refreshVisibility()
        this.refreshHeatmapAppearance()
        this.onLoadProgress?.({ loaded: result.totalNodes, total: result.totalNodes })
        return
      }
      result = loader.append(profile.batchSize)
      this.fg.graphData({ nodes: result.data.nodes, links: result.data.links })
      this.onLoadProgress?.({ loaded: result.loadedNodes, total: result.totalNodes })
      pumpFrame = requestAnimationFrame(pump)
    }

    if (!result.done) {
      pumpFrame = requestAnimationFrame(pump)
    } else {
      this.refreshVisibility()
      this.refreshHeatmapAppearance()
    }
    // expose cancel handle so pause() can stop in-flight loading
    ;(this as Record<string, unknown>)._pumpFrame = pumpFrame
  }

  applyUpdate(g: Graph): void {
    this._apiGraph = g
    if (this._progressivePump) {
      this._progressivePump = null
    }

    const degree = computeDegree(g.edges)
    const nodes = g.nodes.map(n => {
      const fresh = this.hydrate(n, degree.get(n.id) || 0)
      const existing = this.nodeIndex.get(n.id)
      if (existing) {
        Object.assign(existing, fresh)
        return existing
      }
      this.nodeIndex.set(n.id, fresh)
      return fresh
    })

    const newIds = new Set(g.nodes.map(n => n.id))
    for (const id of this.nodeIndex.keys()) {
      if (!newIds.has(id)) this.nodeIndex.delete(id)
    }

    const links = g.edges.map((e: Edge) => ({ source: e.source, target: e.target, type: e.type }))
    this._lodNodeCount = nodes.length
    this._recomputeHeatmapStats()

    const profile = this.getEffectiveProfile(nodes.length)
    this.minimapStride = profile.minimapStride
    this._applyLayoutForces(profile)
    this._rebuildStarfield(nodes, profile)
    if (nodes.length >= 800) {
      this.fg.linkResolution(0)
    } else {
      this.fg.linkResolution(6)
    }

    if (nodes.length < 150) {
      this.fg.graphData({ nodes, links })
      this.refreshVisibility()
      return
    }

    const loader = createProgressiveLoader({ nodes, links })
    let result = loader.append(profile.initialBatchSize)
    this.fg.graphData({ nodes: result.data.nodes, links: result.data.links })
    this.onLoadProgress?.({ loaded: result.loadedNodes, total: result.totalNodes })

    const pump = () => {
      if (this._paused) return
      if (result.done) {
        this._progressivePump = null
        this.refreshVisibility()
        this.onLoadProgress?.({ loaded: result.totalNodes, total: result.totalNodes })
        return
      }
      result = loader.append(profile.batchSize)
      this.fg.graphData({ nodes: result.data.nodes, links: result.data.links })
      this.onLoadProgress?.({ loaded: result.loadedNodes, total: result.totalNodes })
      requestAnimationFrame(pump)
    }
    this._progressivePump = pump
    if (!result.done) {
      requestAnimationFrame(pump)
    } else {
      this.refreshVisibility()
    }
  }

  updateNodeStudyCount(nodeId: string, studyCount: number): void {
    const node = this.nodeIndex.get(nodeId)
    if (!node) return
    const meta: Record<string, unknown> = { ...(node.metadata as Record<string, unknown>), study_count: studyCount }
    node.metadata = meta
    const degree = Number(node.degree) || 0
    node.weight = 1 + studyCount * 0.3 + Math.sqrt(degree) * 1.5
    meta.study_score = studyCount * 3 + Math.min(degree, 10)
    node.metadata = meta
    this._recomputeHeatmapStats()
    if (!this._inFocusMode) {
      this.refreshVisibility()
      this.refreshHeatmapAppearance()
    }
  }

  onNodeClick(handler: (node: Record<string, unknown>) => void): void {
    this.fg.onNodeClick(handler)
  }

  onNodeHover(handler: (node: Record<string, unknown> | null) => void): void {
    this.fg.onNodeHover(handler)
  }

  onNodeRightClick(handler: (node: Record<string, unknown>, event: MouseEvent) => void): void {
    this.fg.onNodeRightClick(handler)
  }

  private hydrate(n: Node, degree = 0): Record<string, unknown> {
    return hydrateNodeForLayout(n, degree, this.layoutMode)
  }

  destroy(): void {
    cancelAnimationFrame(this._rafId)
    this.setConstellationFigures(null)
    sphereGeoCache.forEach(g => g.dispose())
    sphereGeoCache.clear()
    ringGeoCache.forEach(g => g.dispose())
    ringGeoCache.clear()
    lambertMatCache.forEach(m => m.dispose())
    lambertMatCache.clear()
    basicMatCache.forEach(m => m.dispose())
    basicMatCache.clear()
    ringMatCache.forEach(m => m.dispose())
    ringMatCache.clear()
    ;(this.fg as unknown as { _destructor: () => void })._destructor()
  }
}
