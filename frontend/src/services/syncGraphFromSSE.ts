import type { Graph } from '../lib/bridge'
import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import { loadViewPrefs } from '../render3d/viewPrefs'

export interface SyncGraphContext {
  engine: Graph3DEngine
  getOverview: () => { top_workspaces?: Array<{ workspace: string }> } | null
  onStats: (graph: Graph) => void
  onSearchSetup: (nodes: Graph['nodes']) => void
  onMinimapInvalidate: () => void
  onMinimapUpdate: () => void
  refreshStructure?: () => Promise<void>
  onViewOptionsRender: () => void
  onQuickAccessRefresh?: () => void
  getCurrentNodeId: () => string | null
  refreshNeighbors: (nodeId: string) => void
  selectNode: (id: string, delay?: number) => Promise<void>
  addActivityLog?: (msg: string, type?: string) => void
  isGraphHydrated: () => boolean
  setGraphHydrated: (v: boolean) => void
}

export function processGraphUpdate(
  updated: Graph,
  event: 'init' | 'update',
  ctx: SyncGraphContext,
): void {
  if (event === 'init' && ctx.isGraphHydrated()) {
    return
  }
  ctx.engine.applyUpdate(updated)
  ctx.setGraphHydrated(true)
  ctx.onStats(updated)
  ctx.onMinimapInvalidate()
  ctx.onMinimapUpdate()
  void ctx.refreshStructure?.()
  ctx.onSearchSetup(updated.nodes)
  ctx.onViewOptionsRender()
  ctx.onQuickAccessRefresh?.()
  const nodeId = ctx.getCurrentNodeId()
  if (nodeId) ctx.refreshNeighbors(nodeId)

  ctx.addActivityLog?.(
    `Grafo sincronizado: ${updated.nodes.length} nodos, ${updated.edges.length} aristas.`,
    'info',
  )

  const remaining = ctx.engine.drainPendingFocusQueue(updated, {
    selectNode: ctx.selectNode,
    addActivityLog: ctx.addActivityLog,
  })
  ctx.engine.setPendingFocusQueue(remaining)

  if (loadViewPrefs().layoutMode === 'constellation') {
    ctx.engine.setLayoutMode('constellation')
  }
}
