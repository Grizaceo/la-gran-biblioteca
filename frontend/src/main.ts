import { fetchGraph, fetchOverview, fetchOverviewStructure, subscribeToUpdates } from './lib/bridge'
import { processGraphUpdate } from './services/syncGraphFromSSE'
import type { Graph, Overview, OverviewStructure } from './lib/bridge'
import { Graph3DEngine } from './render3d/Graph3DEngine'
import { initSearch } from './render3d/ui/search.js'
import { initMinimap } from './render3d/ui/minimap.js'
import { initFocus } from './render3d/ui/focus.js'
import { initVisibility } from './render3d/ui/visibility.js'
import { initViewOptions } from './render3d/ui/viewOptions.js'
import { setupDetailPanel } from './ui/detailPanel'
import { setupTooltip } from './ui/tooltip'
import { setupContextMenu } from './ui/contextMenu'
import { initQuickAccessBar, refreshQuickAccessLabels } from './ui/quickAccessBar'
import { initLegendDock } from './ui/legendDock'
import { initMenuBar } from './ui/menuBar'
import { initConstellationSettings } from './ui/constellationSettings'
import { initPanelDock } from './ui/panelDock'
import { initAgentLensBar } from './ui/agentLensBar'
import { initIndexTour } from './ui/indexTour'
import { initCoverageMap } from './ui/coverageMap'
import { resetExplorerState } from './ui/navigationReset'
import { addActivityLog } from './lib/activityLog'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function formatStats(graph: Graph, overview: Overview | null): string {
  const shown = graph.nodes.length
  const total = graph.total ?? overview?.total_nodes ?? shown
  const edges = graph.edges.length
  let text = total > shown
    ? `${shown} / ${total} nodos · ${edges} aristas`
    : `${shown} nodos · ${edges} aristas`
  const top = overview?.top_workspaces?.[0]
  if (top?.workspace) {
    text += ` · ${top.workspace}`
  }
  return text
}

async function init(): Promise<void> {
  const container   = document.getElementById('graph-container')!
  const loadingText = document.getElementById('loading-text')!
  const loadingErr  = document.getElementById('loading-error')!
  const statsEl     = document.getElementById('stats')!
  const statusEl    = document.getElementById('status')!
  const loadingEl   = document.getElementById('loading')!

  let currentGraph: Graph | null = null
  let overview: Overview | null = null
  let overviewStructure: OverviewStructure | null = null
  let graphHydrated = false
  let coverageMap: ReturnType<typeof initCoverageMap> | null = null

  function showError(msg: string, err?: Error): void {
    loadingText.style.display = 'none'
    ;(loadingEl.querySelector('.spinner') as HTMLElement).style.display = 'none'
    loadingErr.style.display = 'block'
    loadingErr.textContent   = msg
    if (err) console.error(msg, err)
  }

  function showToast(msg: string, isError = false): void {
    const toast = document.getElementById('info-msg')!
    toast.textContent = msg
    toast.style.color = isError ? '#ef5350' : '#4fc3f7'
    setTimeout(() => { toast.textContent = ''; toast.style.color = '' }, 4000)
  }

  document.title = 'LGB – iniciando…'
  const step = (msg: string) => { loadingText.textContent = msg; document.title = 'LGB – ' + msg }

  step('1/6 Conectando al backend…')
  let graph: Graph
  try {
    const [g, ov, structure] = await Promise.all([fetchGraph(), fetchOverview(), fetchOverviewStructure()])
    graph = g
    overview = ov
    overviewStructure = structure
  } catch (err) {
    showError(`No se pudo conectar al backend: ${(err as Error).message}`)
    return
  }
  currentGraph = graph
  statsEl.textContent = formatStats(graph, overview)

  step('2/6 Iniciando motor 3D…')
  let engine: Graph3DEngine
  try {
    engine = new Graph3DEngine(container)
    if (overview?.workspace_root) {
      engine.setWorkspaceRoot(overview.workspace_root)
    }
    engine.onLoadProgress = ({ loaded, total }) => {
      if (total > 0) {
        loadingText.textContent = `4/6 Cargando grafo… ${loaded}/${total} nodos`
      }
    }
  } catch (err) {
    showError(`Error motor 3D: ${(err as Error).message}`, err as Error)
    return
  }

  // ── UI wiring ────────────────────────────────────────────────────────────

  step('3/6 Conectando UI…')
  let panel!: ReturnType<typeof setupDetailPanel>
  let viewOptions!: ReturnType<typeof initViewOptions>
  let focus!: ReturnType<typeof initFocus>
  let search!: ReturnType<typeof initSearch>
  let agentLensBar!: ReturnType<typeof initAgentLensBar>
  let quickAccess!: ReturnType<typeof initQuickAccessBar>
  const explorerActions = { reset: (): void => {} }
  try {
    initPanelDock()

    focus = initFocus(engine.fg, engine)

    coverageMap = initCoverageMap({
      engine,
      forceGraph: engine.fg,
      showToast,
      getGraphTotal: () => currentGraph?.total ?? overview?.total_nodes,
      getGraphShown: () => currentGraph?.nodes.length,
    })
    initVisibility(engine)
    viewOptions = initViewOptions(engine)
    const constellationSettings = initConstellationSettings(engine, showToast, () => currentGraph)

    panel = setupDetailPanel(
      container,
      engine,
      () => currentGraph,
      showToast,
      constellationSettings,
    )

    setupTooltip(engine, container, (node) => focus.setHoveredNode(node))

    let quickAccessRender = (): void => {}
    setupContextMenu(engine, showToast, () => quickAccessRender())
    quickAccess = initQuickAccessBar({ engine, showToast })
    quickAccessRender = quickAccess.render
    initLegendDock()

    initMenuBar(engine, {
      openViewOptions: () => viewOptions?.openPanel?.(),
      constellationSettings,
      onRescanComplete: () => {
        statusEl.textContent = 'Sincronizando tras escaneo…'
      },
      resetExplorer: () => explorerActions.reset(),
    })

    // Activity Log Collapsible
    const logPanel = document.getElementById('activity-log')
    const logHeader = document.getElementById('activity-log-header')
    if (logPanel && logHeader) {
      logHeader.addEventListener('click', () => {
        logPanel.classList.toggle('expanded')
      })
    }

    engine.onNodeClick(async (node) => {
      await panel.selectNode(node.id as string)
    })

    window.addEventListener('resize', () => {
      const { width, height } = container.getBoundingClientRect()
      if (width > 0 && height > 0) engine.fg.width(width).height(height)
    })
  } catch (err) {
    showError(`Error UI: ${(err as Error).message}`, err as Error)
    return
  }

  step('4/6 Cargando grafo…')
  try {
    engine.setGraph(graph)
    graphHydrated = true
  } catch (err) {
    showError(`Error cargando grafo: ${(err as Error).message}`, err as Error)
    return
  }

  statsEl.textContent = formatStats(graph, overview)
  coverageMap?.refreshCapBanner()

  statusEl.textContent = 'Conectado'

  addActivityLog('¡Conexión establecida con el backend de La Gran Biblioteca!', 'success')
  addActivityLog(`Grafo inicial cargado: ${graph.nodes.length} nodos y ${graph.edges.length} enlaces.`, 'info')

  step('5/6 Iniciando minimap y búsqueda…')
  try {
    const minimap = initMinimap(engine.fg, engine, {
      showToast,
      onFiltersChange: () => viewOptions.renderList(),
    }) as {
      update: () => void
      invalidateBounds: () => void
      setStructure: (data: OverviewStructure | null) => void
    }
    search = initSearch(engine.fg, engine)

    explorerActions.reset = () => {
      resetExplorerState({
        engine,
        clearFocus: () => focus.clearAllFocus(),
        resetSearch: () => search.resetSearch(),
        resetViewOptions: () => {
          viewOptions.resetFilters?.()
          viewOptions.renderList()
        },
        closeDetailPanel: () => panel.closePanel(),
        dismissAgentLens: () => agentLensBar.dismissAgentLensUi?.(),
      })
      showToast('Vista y filtros restablecidos', false)
      addActivityLog('Explorador restablecido (cámara, búsqueda, filtros).', 'info')
    }

    document.getElementById('btn-reset')!.addEventListener('click', () => {
      explorerActions.reset()
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !(e.target instanceof HTMLInputElement)
        && !(e.target instanceof HTMLTextAreaElement)
        && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault()
        explorerActions.reset()
      }
    })

    engine.onMinimapTick = () => minimap.update()
    engine.onStop = () => minimap.invalidateBounds()

    search.setup(graph.nodes)
    minimap.setStructure(overviewStructure)
    minimap.update()
    viewOptions.renderList()

    coverageMap?.refreshCapBanner()

    agentLensBar = initAgentLensBar({
      engine,
      showToast,
      selectNode: (id, delay) => panel.selectNode(id, delay),
      enterAgentFocus: focus.enterAgentFocus,
    })

    initIndexTour({
      engine,
      showToast,
      selectNode: (id, delay) => panel.selectNode(id, delay),
      getDefaultWorkspace: () => overview?.top_workspaces?.[0]?.workspace ?? null,
    })

    const unsubscribe = subscribeToUpdates((updated, event) => {
      currentGraph = updated
      processGraphUpdate(updated, event, {
        engine,
        getOverview: () => overview,
        onStats: (g) => {
          statsEl.textContent = formatStats(g, overview)
          coverageMap?.refreshCapBanner()
        },
        onSearchSetup: (nodes) => search.setup(nodes),
        onMinimapInvalidate: () => minimap.invalidateBounds(),
        onMinimapUpdate: () => minimap.update(),
        refreshStructure: async () => {
          try {
            overviewStructure = await fetchOverviewStructure()
            minimap.setStructure(overviewStructure)
          } catch (err) {
            console.warn('[LGB] structure refresh failed', err)
          }
        },
        onViewOptionsRender: () => viewOptions.renderList(),
        onQuickAccessRefresh: () => {
          refreshQuickAccessLabels(engine)
          quickAccess.render()
        },
        getCurrentNodeId: () => panel.getCurrentNodeId(),
        refreshNeighbors: (id) => { panel.refreshNeighbors(id) },
        selectNode: (id, delay) => panel.selectNode(id, delay),
        addActivityLog,
        isGraphHydrated: () => graphHydrated,
        setGraphHydrated: (v) => { graphHydrated = v },
      })
    })
    window.addEventListener('beforeunload', () => {
      unsubscribe()
      agentLensBar.destroy()
    })
  } catch (err) {
    showError(`Error minimap/búsqueda: ${(err as Error).message}`, err as Error)
    return
  }

  loadingEl.style.transition = 'opacity 0.5s'
  loadingEl.style.opacity = '0'
  setTimeout(() => { loadingEl.style.display = 'none' }, 500)

  document.title = 'La Gran Biblioteca'
  if (import.meta.env.DEV) {
    console.log('[LGB] Ready —', graph.nodes.length, 'nodes,', graph.edges.length, 'edges')
  }
}

init().catch(err => console.error('[LGB] Init failed:', err))
