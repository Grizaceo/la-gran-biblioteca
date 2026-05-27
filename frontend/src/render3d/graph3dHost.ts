import type * as THREE from 'three'
import type { GraphFiltersState, HeatmapMode, LayoutMode } from './viewPrefs'

/** Shared engine surface exposed to render3d managers. */
export interface Graph3DEngineHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly fg: any
  readonly nodeIndex: Map<string, Record<string, unknown>>
  readonly workspaceRoot: string
  readonly graphFilters: GraphFiltersState
  readonly hiddenTypes: Set<string>
  readonly inFocusMode: boolean
  readonly heatmapMode: HeatmapMode
  readonly layoutMode: LayoutMode
  readonly heatmapStats: { maxStudyScore: number; maxDegree: number }
  readonly highlightNodeIds: Set<string>
  readonly highlightMeshes: THREE.Object3D[]
  setHighlightMeshes(meshes: THREE.Object3D[]): void
  setHeatmapStats(stats: { maxStudyScore: number; maxDegree: number }): void
  getNodeWorkspace(node: Record<string, unknown>): string
  isNodeGraphVisible(node: Record<string, unknown>): boolean
  isLinkGraphVisible(link: Record<string, unknown>): boolean
  onParticlesNeedUpdate(): void
}
