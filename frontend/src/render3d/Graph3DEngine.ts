// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import type { Node, Edge, Graph } from '../lib/bridge'
import type { ConstellationFigure } from '../lib/api/types'
import { PALETTE } from './palette.js'
import {
  getRenderProfile,
  createProgressiveLoader,
  computeGraphBounds3D,
  buildStarfieldConfig,
  type RenderProfile,
} from './renderOptimizations'
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
import {
  getSphereGeo,
  getRingGeo,
  getLambertMat,
  getBasicMat,
  getLowBasicMat,
  getRingMat,
  disposeGpuCaches,
} from './gpuCache'
import { computeDegree, nodeDisplaySize } from './graph3dMath'
import { createStarfield } from './graph3dStarfield'
import type { Graph3DEngineHost } from './graph3dHost'
import { LODManager } from './LODManager'
import { FilterManager } from './FilterManager'
import { ParticleManager } from './ParticleManager'
import { LayoutManager } from './LayoutManager'

export type { GraphFiltersState }

export interface LoadProgress {
  loaded: number
  total: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Graph3DEngine implements Graph3DEngineHost {
  fg: any
  onMinimapTick?: () => void
  onStop?: () => void
  onTypesChanged?: () => void

  public starfieldRotationEnabled = true
  public minimapStride = 1
  public qualityPreset: QualityPreset = 'auto'
  public layoutMode: LayoutMode = getLayoutMode()
  public pendingFocusQueue: string[] = []

  onLoadProgress?: (p: LoadProgress) => void

  readonly nodeIndex = new Map<string, Record<string, unknown>>()
  workspaceRoot = ''
  heatmapStats = { maxStudyScore: 1, maxDegree: 1 }
  highlightMeshes: THREE.Object3D[] = []

  private lod!: LODManager
  private filter!: FilterManager
  private particles!: ParticleManager
  private layout!: LayoutManager

  private starfield: THREE.Points
  private _starfieldOuterRadius = 0
  private _zoomOnStop = false
  private _rafId = 0
  private _rafFrame = 0
  private _paused = false
  private _savedParticles = 2
  private _savedStarfieldRotation = true
  private _savedPhotonsEnabled = true
  private _savedCooldownTicks = 0
  private _tick!: () => void
  private _progressivePump: (() => void) | null = null
  private _apiGraph: Graph | null = null

  get graphFilters(): GraphFiltersState {
    return this.filter.getGraphFilters()
  }

  get hiddenTypes(): Set<string> {
    return this.filter.getHiddenTypes()
  }

  get inFocusMode(): boolean {
    return this.filter.getInFocusMode()
  }

  get heatmapMode(): HeatmapMode {
    return this.filter.getHeatmapModeValue()
  }

  set heatmapMode(mode: HeatmapMode) {
    this.filter.setHeatmapMode(mode)
  }

  get highlightNodeIds(): Set<string> {
    return this.filter.getHighlightNodeIds()
  }

  constructor(container: HTMLElement) {
    this.fg = this._createForceGraph(container)
    this.lod = new LODManager(this.fg)
    this.filter = new FilterManager(this.fg, this, () => {
      this.particles.updateParticleVisibility()
    })
    this.particles = new ParticleManager(this.fg, this)
    this.layout = new LayoutManager(this.fg, this.layoutMode)

    const bootProfile = getRenderProfile(400)
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

    this._tick = () => {
      this._rafId = requestAnimationFrame(this._tick)
      try {
        if (this.starfieldRotationEnabled) {
          this.starfield.rotation.y += 0.0001
          this.starfield.rotation.x += 0.00005
        }
        if (++this._rafFrame % 6 === 0) {
          this.particles.updateParticleVisibility()
          this.lod.updateLOD()
        }
      } catch (_) { /* swallow — loop must survive */ }
    }
    this._rafId = requestAnimationFrame(this._tick)
  }

  get photonsEnabled(): boolean {
    return this.particles.photonsEnabled
  }

  set photonsEnabled(enabled: boolean) {
    this.particles.photonsEnabled = enabled
  }

  get showLabels(): boolean {
    return this.lod.getShowLabels()
  }

  set showLabels(show: boolean) {
    this.lod.setShowLabels(show)
  }

  setHighlightMeshes(meshes: THREE.Object3D[]): void {
    this.highlightMeshes = meshes
  }

  setHeatmapStats(stats: { maxStudyScore: number; maxDegree: number }): void {
    this.heatmapStats = stats
  }

  onParticlesNeedUpdate(): void {
    this.particles.updateParticleVisibility()
  }

  getNodeWorkspace(node: Record<string, unknown>): string {
    return this.filter.getNodeWorkspace(node)
  }

  isNodeGraphVisible(node: Record<string, unknown>): boolean {
    return this.filter.isNodeGraphVisible(node)
  }

  isLinkGraphVisible(link: Record<string, unknown>): boolean {
    return this.filter.isLinkGraphVisible(link)
  }

  private _createForceGraph(container: HTMLElement): unknown {
    const bootProfile = getRenderProfile(400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FG3D = ForceGraph3D as any
    return FG3D({
      controlType: 'orbit',
      rendererConfig: { antialias: bootProfile.antialias, alpha: false },
    })(container)
      .nodeLabel((node: Record<string, unknown>) =>
        this.showLabels ? String(node.name || node.label || node.id || '') : '')
      .nodeThreeObject((node: Record<string, unknown>) => {
        const size = nodeDisplaySize(node, this.heatmapMode)
        const type = (node.type as string) || 'default'

        const group = new THREE.Group()
        group.userData = { _lodDistance: size }

        const hiMesh = new THREE.Mesh(
          getSphereGeo(size, this.lod.getLodSegHi()),
          getLambertMat(type),
        )
        hiMesh.name = 'lod_hi'

        const ringGeo = getRingGeo(size - 0.5, size + 0.5, 24)
        const ring = new THREE.Mesh(ringGeo, getRingMat(type))
        ring.lookAt(new THREE.Vector3(0, 0, 1))
        ring.name = 'lod_ring'
        hiMesh.add(ring)
        group.add(hiMesh)

        const midMesh = new THREE.Mesh(
          getSphereGeo(size, this.lod.getLodSegMid()),
          getBasicMat(type),
        )
        midMesh.name = 'lod_mid'
        midMesh.visible = false
        group.add(midMesh)

        const lowMesh = new THREE.Mesh(
          getSphereGeo(size, this.lod.getLodSegLow()),
          getLowBasicMat(type),
        )
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
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
  }

  getGraphFilters(): GraphFiltersState {
    return this.filter.getGraphFilters()
  }

  setGraphFilters(partial: Partial<GraphFiltersState>): void {
    this.filter.setGraphFilters(partial)
  }

  getWorkspaceList(): string[] {
    return this.filter.getWorkspaceList()
  }

  ensureImportsWorkspaceVisible(): void {
    this.filter.ensureImportsWorkspaceVisible()
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
    this.filter.setFocusMode(active)
  }

  setHeatmapMode(mode: HeatmapMode): void {
    this.filter.setHeatmapMode(mode)
  }

  getHeatmapMode(): HeatmapMode {
    return this.filter.getHeatmapMode()
  }

  setHighlightNodeIds(ids: string[] | null | undefined): void {
    this.filter.setHighlightNodeIds(ids)
  }

  refreshHeatmapAppearance(): void {
    this.filter.refreshHeatmapAppearance()
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
    this.filter.refreshVisibility()
  }

  setLayoutMode(mode: LayoutMode): void {
    this.layoutMode = mode
    this.layout.setLayoutMode(mode)
    if (mode !== 'constellation') this.setConstellationFigures(null)
    if (this._apiGraph) this.setGraph(this._apiGraph)
  }

  setConstellationFigures(figures: ConstellationFigure[] | null): void {
    this.layout.setConstellationFigures(figures)
  }

  setQualityPreset(preset: QualityPreset): void {
    this.qualityPreset = preset
    const nodeCount = this.lod.getLodNodeCount() || 400
    const profile = this.getEffectiveProfile(nodeCount)
    this._applyLodProfile(profile)
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
    this.lod.setShowLabels(show)
  }

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
    this.particles.applyParticles(this.photonsEnabled ? this._savedParticles : 0)
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(this._tick)
    }
  }

  setPhotonsEnabled(enabled: boolean): void {
    this._savedParticles = this.particles.setPhotonsEnabled(enabled, this._paused)
  }

  setTypeVisible(type: string, visible: boolean): void {
    this.filter.setTypeVisible(type, visible)
  }

  isTypeVisible(type: string): boolean {
    return this.filter.isTypeVisible(type)
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

    const processedNodes = g.nodes.map((n) => {
      const h = this.hydrate(n, degree.get(n.id) || 0)
      this.nodeIndex.set(n.id, h)
      return h
    })
    const processedLinks = g.edges.map((e: Edge) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    }))

    const nodeCount = processedNodes.length
    this.lod.setLodNodeCount(nodeCount)
    const loadedFilters = loadGraphFilters()
    this.filter.loadGraphFilters(loadedFilters)
    this.filter.setHeatmapMode(getHeatmapMode())
    this.filter.recomputeHeatmapStats()
    const profile = this.getEffectiveProfile(nodeCount)
    this._applyLodProfile(profile)

    this.layout.applyLayoutForces(profile)
    this._rebuildStarfield(processedNodes, profile, true)

    if (nodeCount >= 800) {
      this.fg.linkResolution(0)
    } else {
      this.fg.linkResolution(6)
    }

    this._zoomOnStop = true

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
    ;(this as Record<string, unknown>)._pumpFrame = pumpFrame
  }

  applyUpdate(g: Graph): void {
    this._apiGraph = g
    if (this._progressivePump) {
      this._progressivePump = null
    }

    const degree = computeDegree(g.edges)
    const nodes = g.nodes.map((n) => {
      const fresh = this.hydrate(n, degree.get(n.id) || 0)
      const existing = this.nodeIndex.get(n.id)
      if (existing) {
        Object.assign(existing, fresh)
        return existing
      }
      this.nodeIndex.set(n.id, fresh)
      return fresh
    })

    const newIds = new Set(g.nodes.map((n) => n.id))
    for (const id of this.nodeIndex.keys()) {
      if (!newIds.has(id)) this.nodeIndex.delete(id)
    }

    const links = g.edges.map((e: Edge) => ({ source: e.source, target: e.target, type: e.type }))
    this.lod.setLodNodeCount(nodes.length)
    this.filter.recomputeHeatmapStats()

    const profile = this.getEffectiveProfile(nodes.length)
    this._applyLodProfile(profile)
    this.layout.applyLayoutForces(profile)
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
    const meta: Record<string, unknown> = {
      ...(node.metadata as Record<string, unknown>),
      study_count: studyCount,
    }
    node.metadata = meta
    const degree = Number(node.degree) || 0
    node.weight = 1 + studyCount * 0.3 + Math.sqrt(degree) * 1.5
    meta.study_score = studyCount * 3 + Math.min(degree, 10)
    node.metadata = meta
    this.filter.refreshAfterStudyUpdate()
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
    return this.layout.hydrateNodeForLayout(n, degree)
  }

  private _applyLodProfile(profile: RenderProfile): void {
    this.minimapStride = profile.minimapStride
    this.lod.setLodSegments(
      Math.max(4, profile.nodeSegments + 2),
      Math.max(3, profile.nodeSegments),
      Math.max(2, Math.floor(profile.nodeSegments * 0.6)),
    )
  }

  private _rebuildStarfield(
    nodes: Record<string, unknown>[],
    profile: RenderProfile,
    force = false,
  ): void {
    const bounds = computeGraphBounds3D(nodes)
    const delta = Math.abs(bounds.radius - this._starfieldOuterRadius)
      / Math.max(1, this._starfieldOuterRadius)
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

  destroy(): void {
    cancelAnimationFrame(this._rafId)
    this.layout.dispose()
    disposeGpuCaches()
    ;(this.fg as unknown as { _destructor: () => void })._destructor()
  }
}
