import * as THREE from 'three'
import { PALETTE } from './palette.js'
import {
  mergeImportsIntoWorkspaceFilter,
  isLinkGraphVisible,
  isNodeGraphVisible,
  getNodeWorkspace as resolveNodeWorkspace,
} from './graphFilters'
import {
  type GraphFiltersState,
  type HeatmapMode,
  DEFAULT_GRAPH_FILTERS,
  getHeatmapMode,
} from './viewPrefs'
import type { Graph3DEngineHost } from './graph3dHost'
import { heatmapStudyColor, heatmapVolumeColor, nodeDisplaySize } from './graph3dMath'

export class FilterManager {
  private graphFilters: GraphFiltersState = { ...DEFAULT_GRAPH_FILTERS }
  private hiddenTypes = new Set<string>()
  private inFocusMode = false
  private heatmapMode: HeatmapMode = getHeatmapMode()
  private highlightNodeIds = new Set<string>()
  private heatmapStats = { maxStudyScore: 1, maxDegree: 1 }
  private readonly _wsFn: (node: Record<string, unknown>) => string

  constructor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly fg: any,
    private readonly host: Graph3DEngineHost,
    private readonly onVisibilityChanged: () => void,
  ) {
    this._wsFn = (node) => this.getNodeWorkspace(node)
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
    if (!this.inFocusMode) {
      this.applyFilter()
      if (partial.workspaces !== undefined
        || partial.topics !== undefined
        || partial.folders !== undefined
        || partial.studyFilter !== undefined
        || partial.minDegree !== undefined) {
        this.recomputeHeatmapStats()
        this.refreshHeatmapAppearance()
      }
    }
  }

  loadGraphFilters(filters: GraphFiltersState): void {
    this.graphFilters = filters
  }

  setHeatmapMode(mode: HeatmapMode): void {
    this.heatmapMode = mode
    this.recomputeHeatmapStats()
    this.refreshHeatmapAppearance()
    this.applyFilter()
  }

  getHeatmapMode(): HeatmapMode {
    return this.heatmapMode
  }

  setHighlightNodeIds(ids: string[] | null | undefined): void {
    this.highlightNodeIds = new Set(ids || [])
    this.refreshHighlights()
  }

  setFocusMode(active: boolean): void {
    this.inFocusMode = active
    if (!active) this.applyFilter()
  }

  getInFocusMode(): boolean {
    return this.inFocusMode
  }

  getHeatmapModeValue(): HeatmapMode {
    return this.heatmapMode
  }

  getHiddenTypes(): Set<string> {
    return this.hiddenTypes
  }

  getHighlightNodeIds(): Set<string> {
    return this.highlightNodeIds
  }

  setTypeVisible(type: string, visible: boolean): void {
    if (visible) this.hiddenTypes.delete(type)
    else this.hiddenTypes.add(type)
    if (!this.inFocusMode) this.applyFilter()
  }

  isTypeVisible(type: string): boolean {
    return !this.hiddenTypes.has(type)
  }

  getNodeWorkspace(node: Record<string, unknown>): string {
    return resolveNodeWorkspace(node, this.host.workspaceRoot)
  }

  getWorkspaceList(): string[] {
    const ws = new Set<string>()
    for (const node of this.host.nodeIndex.values()) {
      const w = this.getNodeWorkspace(node)
      if (w) ws.add(w)
    }
    return Array.from(ws).sort()
  }

  ensureImportsWorkspaceVisible(): void {
    const patch = mergeImportsIntoWorkspaceFilter(
      this.graphFilters,
      this.getWorkspaceList(),
    )
    if (Object.keys(patch).length) this.setGraphFilters(patch)
  }

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

  applyFilter(): void {
    this.refreshVisibility()
  }

  refreshVisibility(): void {
    const { nodes, links } = this.fg.graphData() as {
      nodes: Record<string, unknown>[]
      links: Record<string, unknown>[]
    }
    for (const n of nodes) {
      const visible = this.isNodeGraphVisible(n)
      n.__filterVisible = visible
      if (!this.inFocusMode) {
        const obj = n.__threeObj as THREE.Object3D | undefined
        if (obj) {
          obj.visible = true
          this.applyNodeVisual(n, visible)
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
      if (!this.inFocusMode) {
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
    this.onVisibilityChanged()
    this.refreshHighlights()
  }

  recomputeHeatmapStats(): void {
    let maxStudyScore = 1
    let maxDegree = 1
    for (const node of this.host.nodeIndex.values()) {
      const meta = (node.metadata as Record<string, unknown>) || {}
      maxStudyScore = Math.max(maxStudyScore, Number(meta.study_score) || 0)
      maxDegree = Math.max(maxDegree, Number(node.degree) || 0)
    }
    this.heatmapStats = { maxStudyScore, maxDegree }
    this.host.setHeatmapStats(this.heatmapStats)
  }

  refreshHeatmapAppearance(): void {
    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    if (!nodes?.length) return
    for (const node of nodes) {
      const passes = this.isNodeGraphVisible(node)
      this.applyNodeVisual(node, passes)
    }
    this.refreshHighlights()
  }

  refreshAfterStudyUpdate(): void {
    this.recomputeHeatmapStats()
    if (!this.inFocusMode) {
      this.applyFilter()
      this.refreshHeatmapAppearance()
    }
  }

  private setMeshColor(mesh: THREE.Mesh, color: THREE.Color, opacity: number): void {
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

  private applyNodeVisual(node: Record<string, unknown>, passesFilter: boolean): void {
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
        this.heatmapStats.maxStudyScore,
      )
      opacity = passesFilter ? 0.9 : 0.12
    } else if (this.heatmapMode === 'volume') {
      color = heatmapVolumeColor(
        Number(node.degree) || 0,
        this.heatmapStats.maxDegree,
      )
      opacity = passesFilter ? 0.88 : 0.12
    } else if (!passesFilter) {
      opacity = 0.14
    }

    const size = nodeDisplaySize(node, this.heatmapMode)
    obj.userData._lodDistance = size
    obj.scale.set(1, 1, 1)

    for (const name of ['lod_hi', 'lod_mid', 'lod_low']) {
      const mesh = obj.getObjectByName(name) as THREE.Mesh | undefined
      if (!mesh) continue
      const baseOpacity = name === 'lod_low' ? 0.45 : name === 'lod_mid' ? 0.7 : 0.85
      this.setMeshColor(mesh, color, opacity * baseOpacity)
    }
    const ring = obj.getObjectByName('lod_ring') as THREE.Mesh | undefined
    if (ring) {
      this.setMeshColor(ring, color, passesFilter ? 0.25 : 0.08)
    }
  }

  private clearHighlights(): void {
    for (const mesh of this.host.highlightMeshes) {
      if (mesh.parent) mesh.parent.remove(mesh)
      mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) obj.geometry.dispose()
      })
      const mat = mesh instanceof THREE.Mesh ? mesh.material : null
      if (mat && !Array.isArray(mat)) mat.dispose()
    }
    this.host.setHighlightMeshes([])
  }

  refreshHighlights(): void {
    this.clearHighlights()
    if (!this.highlightNodeIds.size) return

    const meshes: THREE.Object3D[] = []
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
      meshes.push(highlightMesh)
    }
    this.host.setHighlightMeshes(meshes)
  }
}
