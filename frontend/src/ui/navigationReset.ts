import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import {
  DEFAULT_GRAPH_FILTERS,
  saveGraphFilters,
  saveHeatmapMode,
} from '../render3d/viewPrefs'
import { clearStructureNavFilters } from '../render3d/ui/structureNav'
import { getPanelDock } from './panelDock'

const HIDDEN_TYPES_KEY = 'lgb.hiddenTypes'

export interface ExplorerResetDeps {
  engine: Graph3DEngine
  clearFocus: () => void
  resetSearch: () => void
  resetViewOptions: () => void
  closeDetailPanel?: () => void
  dismissAgentLens?: () => void
}

/** Restaura vista por defecto: cámara, búsqueda, filtros, heatmap, focus, paneles y tipos. */
export function resetExplorerState(deps: ExplorerResetDeps): void {
  const { engine } = deps

  deps.clearFocus()
  deps.resetSearch()
  deps.resetViewOptions()

  try {
    getPanelDock().closeAll()
  } catch { /* dock not ready */ }

  localStorage.removeItem(HIDDEN_TYPES_KEY)
  for (const { type } of engine.getTypeStats()) {
    engine.setTypeVisible(type, true)
  }

  engine.setGraphFilters({ ...DEFAULT_GRAPH_FILTERS, ...clearStructureNavFilters() })
  saveGraphFilters(DEFAULT_GRAPH_FILTERS)

  engine.setHeatmapMode('off')
  saveHeatmapMode('off')
  const legend = document.getElementById('heatmap-legend')
  if (legend) legend.classList.remove('active')

  engine.setHighlightNodeIds([])
  engine.setFocusMode(false)

  deps.dismissAgentLens?.()
  deps.closeDetailPanel?.()

  const info = document.getElementById('info-msg')
  if (info) {
    info.textContent = ''
    info.style.color = ''
  }

  engine.fg.zoomToFit(900, 48)
  setTimeout(() => {
    engine.fg.cameraPosition({ x: 0, y: 0, z: 400 }, null, 800)
  }, 50)
}
