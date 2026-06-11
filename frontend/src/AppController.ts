import { fetchGraph, fetchOverview, fetchOverviewStructure, subscribeToUpdates } from './lib/bridge'
import type { VaultSwitchResponse } from './lib/bridge'
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

export type GraphUpdateEvent = 'init' | 'update'

type DetailPanel = ReturnType<typeof setupDetailPanel>
type ViewOptions = ReturnType<typeof initViewOptions>
type FocusController = ReturnType<typeof initFocus>
type SearchController = ReturnType<typeof initSearch>
type AgentLensBar = ReturnType<typeof initAgentLensBar>
type QuickAccessBar = ReturnType<typeof initQuickAccessBar>
type MinimapController = {
  update: () => void
  invalidateBounds: () => void
  setStructure: (data: OverviewStructure | null) => void
}

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
  const vaultName = overview?.vault?.name
  if (vaultName) {
    text = `${vaultName} · ${text}`
  }
  return text
}

export class AppController {
  private readonly container: HTMLElement
  private readonly loadingText: HTMLElement
  private readonly loadingErr: HTMLElement
  private readonly statsEl: HTMLElement
  private readonly statusEl: HTMLElement
  private readonly loadingEl: HTMLElement

  private engine!: Graph3DEngine
  private panel!: DetailPanel
  private currentGraph: Graph | null = null
  private overview: Overview | null = null
  private overviewStructure: OverviewStructure | null = null
  private graphHydrated = false
  private coverageMap: ReturnType<typeof initCoverageMap> | null = null

  private viewOptions!: ViewOptions
  private focus!: FocusController
  private search!: SearchController
  private agentLensBar!: AgentLensBar
  private quickAccess!: QuickAccessBar
  private minimap!: MinimapController

  private unsubscribeUpdates: (() => void) | null = null
  private readonly explorerActions = { reset: (): void => {} }

  constructor(container: HTMLElement) {
    this.container = container
    this.loadingText = document.getElementById('loading-text')!
    this.loadingErr = document.getElementById('loading-error')!
    this.statsEl = document.getElementById('stats')!
    this.statusEl = document.getElementById('status')!
    this.loadingEl = document.getElementById('loading')!
  }

  async boot(): Promise<void> {
    document.title = 'LGB – iniciando…'
    const step = (msg: string) => {
      this.loadingText.textContent = msg
      document.title = 'LGB – ' + msg
    }

    step('1/6 Conectando al backend…')
    let graph: Graph
    try {
      const [g, ov, structure] = await Promise.all([
        fetchGraph(),
        fetchOverview(),
        fetchOverviewStructure(),
      ])
      graph = g
      this.overview = ov
      this.overviewStructure = structure
    } catch (err) {
      this.showError(`No se pudo conectar al backend: ${(err as Error).message}`)
      return
    }
    this.currentGraph = graph
    this.statsEl.textContent = formatStats(graph, this.overview)

    step('2/6 Iniciando motor 3D…')
    try {
      this.engine = new Graph3DEngine(this.container)
      if (this.overview?.workspace_root) {
        this.engine.setWorkspaceRoot(this.overview.workspace_root)
      }
      this.engine.onLoadProgress = ({ loaded, total }) => {
        if (total > 0) {
          this.loadingText.textContent = `4/6 Cargando grafo… ${loaded}/${total} nodos`
        }
      }
    } catch (err) {
      this.showError(`Error motor 3D: ${(err as Error).message}`, err as Error)
      return
    }

    step('3/6 Conectando UI…')
    try {
      this.wireUi()
    } catch (err) {
      this.showError(`Error UI: ${(err as Error).message}`, err as Error)
      return
    }

    step('4/6 Cargando grafo…')
    try {
      this.engine.setGraph(graph)
      this.graphHydrated = true
    } catch (err) {
      this.showError(`Error cargando grafo: ${(err as Error).message}`, err as Error)
      return
    }

    this.statsEl.textContent = formatStats(graph, this.overview)
    this.coverageMap?.refreshCapBanner()
    this.statusEl.textContent = this.overview?.vault?.name ?? 'Conectado'

    addActivityLog('¡Conexión establecida con el backend de La Gran Biblioteca!', 'success')
    addActivityLog(
      `Grafo inicial cargado: ${graph.nodes.length} nodos y ${graph.edges.length} enlaces.`,
      'info',
    )

    step('5/6 Iniciando minimap y búsqueda…')
    try {
      this.wireSearchAndRealtime(graph)
    } catch (err) {
      this.showError(`Error minimap/búsqueda: ${(err as Error).message}`, err as Error)
      return
    }

    this.loadingEl.style.transition = 'opacity 0.5s'
    this.loadingEl.style.opacity = '0'
    setTimeout(() => { this.loadingEl.style.display = 'none' }, 500)

    document.title = 'La Gran Biblioteca'
    if (import.meta.env.DEV) {
      console.log('[LGB] Ready —', graph.nodes.length, 'nodes,', graph.edges.length, 'edges')
    }
  }

  destroy(): void {
    this.unsubscribeUpdates?.()
    this.unsubscribeUpdates = null
    this.agentLensBar?.destroy()
    this.engine?.destroy()
  }

  private async reloadAfterVaultSwitch(result: VaultSwitchResponse): Promise<void> {
    this.loadingEl.style.display = 'flex'
    this.loadingEl.style.opacity = '1'
    this.loadingText.textContent = `Cargando biblioteca ${result.vault.name}…`
    this.statusEl.textContent = result.vault.name
    try {
      const [g, ov, structure] = await Promise.all([
        fetchGraph(),
        fetchOverview(),
        fetchOverviewStructure(),
      ])
      this.currentGraph = g
      this.overview = ov
      this.overviewStructure = structure
      if (ov.workspace_root) {
        this.engine.setWorkspaceRoot(ov.workspace_root)
      }
      this.engine.setGraph(g)
      this.graphHydrated = true
      this.explorerActions.reset()
      this.search.setup(g.nodes)
      this.minimap.setStructure(structure)
      this.minimap.invalidateBounds()
      this.minimap.update()
      this.viewOptions.renderList()
      this.statsEl.textContent = formatStats(g, ov)
      this.statusEl.textContent = ov.vault?.name ?? result.vault.name
      this.coverageMap?.refreshCapBanner()
      addActivityLog(
        `Biblioteca activa: ${result.vault.name} (${result.nodes} nodos).`,
        'success',
      )
    } catch (err) {
      this.showToast(`Error al cargar biblioteca: ${(err as Error).message}`, true)
    } finally {
      this.loadingEl.style.transition = 'opacity 0.4s'
      this.loadingEl.style.opacity = '0'
      setTimeout(() => { this.loadingEl.style.display = 'none' }, 400)
    }
  }

  private async syncOverviewAfterGraphChange(graph: Graph): Promise<void> {
    try {
      const ov = await fetchOverview()
      this.overview = ov
      if (ov.workspace_root) {
        this.engine.setWorkspaceRoot(ov.workspace_root)
      }
      if (ov.vault?.name) {
        this.statusEl.textContent = ov.vault.name
      }
      this.statsEl.textContent = formatStats(graph, ov)
      this.coverageMap?.refreshCapBanner()
    } catch (err) {
      console.warn('[LGB] overview sync after graph change failed', err)
    }
  }

  private onGraphUpdate(g: Graph, event: GraphUpdateEvent): void {
    void this.syncOverviewAfterGraphChange(g)
    this.currentGraph = g
    processGraphUpdate(g, event, {
      engine: this.engine,
      getOverview: () => this.overview,
      onStats: (updated) => {
        this.statsEl.textContent = formatStats(updated, this.overview)
        this.coverageMap?.refreshCapBanner()
      },
      onSearchSetup: (nodes) => this.search.setup(nodes),
      onMinimapInvalidate: () => this.minimap.invalidateBounds(),
      onMinimapUpdate: () => this.minimap.update(),
      refreshStructure: async () => {
        try {
          this.overviewStructure = await fetchOverviewStructure()
          this.minimap.setStructure(this.overviewStructure)
        } catch (err) {
          console.warn('[LGB] structure refresh failed', err)
        }
      },
      onViewOptionsRender: () => this.viewOptions.renderList(),
      onQuickAccessRefresh: () => {
        refreshQuickAccessLabels(this.engine)
        this.quickAccess.render()
      },
      getCurrentNodeId: () => this.panel.getCurrentNodeId(),
      refreshNeighbors: (id) => { this.panel.refreshNeighbors(id) },
      selectNode: (id, delay) => this.panel.selectNode(id, delay),
      addActivityLog,
      isGraphHydrated: () => this.graphHydrated,
      setGraphHydrated: (v) => { this.graphHydrated = v },
    })
  }

  private wireUi(): void {
    initPanelDock()

    this.focus = initFocus(this.engine.fg, this.engine, () => this.panel.getCurrentNodeId())

    this.coverageMap = initCoverageMap({
      engine: this.engine,
      forceGraph: this.engine.fg,
      showToast: (msg, isError) => this.showToast(msg, isError),
      getGraphTotal: () => this.currentGraph?.total ?? this.overview?.total_nodes,
      getGraphShown: () => this.currentGraph?.nodes.length,
    })
    initVisibility(this.engine)
    this.viewOptions = initViewOptions(this.engine)
    const constellationSettings = initConstellationSettings(
      this.engine,
      (msg, isError) => this.showToast(msg, isError),
      () => this.currentGraph,
    )

    this.panel = setupDetailPanel(
      this.container,
      this.engine,
      () => this.currentGraph,
      (msg, isError) => this.showToast(msg, isError),
      constellationSettings,
    )

    setupTooltip(this.engine, this.container, (node) => this.focus.setHoveredNode(node))

    let quickAccessRender = (): void => {}
    setupContextMenu(
      this.engine,
      (msg, isError) => this.showToast(msg, isError),
      () => quickAccessRender(),
    )
    this.quickAccess = initQuickAccessBar({
      engine: this.engine,
      showToast: (msg, isError) => this.showToast(msg, isError),
    })
    quickAccessRender = this.quickAccess.render
    initLegendDock()

    initMenuBar(this.engine, {
      openViewOptions: () => this.viewOptions?.openPanel?.(),
      constellationSettings,
      onRescanComplete: () => {
        this.statusEl.textContent = this.overview?.vault?.name ?? 'Sincronizando tras escaneo…'
      },
      resetExplorer: () => this.explorerActions.reset(),
      onVaultSwitch: (result) => this.reloadAfterVaultSwitch(result),
    })

    const logPanel = document.getElementById('activity-log')
    const logHeader = document.getElementById('activity-log-header')
    if (logPanel && logHeader) {
      logHeader.addEventListener('click', () => {
        logPanel.classList.toggle('expanded')
      })
    }

    this.engine.onNodeClick(async (node) => {
      await this.panel.selectNode(node.id as string)
    })

    window.addEventListener('resize', () => {
      const { width, height } = this.container.getBoundingClientRect()
      if (width > 0 && height > 0) this.engine.fg.width(width).height(height)
    })
  }

  private wireSearchAndRealtime(graph: Graph): void {
    this.minimap = initMinimap(this.engine.fg, this.engine, {
      showToast: (msg, isError) => this.showToast(msg, isError),
      onFiltersChange: () => this.viewOptions.renderList(),
    }) as MinimapController
    this.search = initSearch(this.engine.fg, this.engine)

    this.explorerActions.reset = () => {
      resetExplorerState({
        engine: this.engine,
        clearFocus: () => this.focus.clearAllFocus(),
        resetSearch: () => this.search.resetSearch(),
        resetViewOptions: () => {
          this.viewOptions.resetFilters?.()
          this.viewOptions.renderList()
        },
        closeDetailPanel: () => this.panel.closePanel(),
        dismissAgentLens: () => this.agentLensBar.dismissAgentLensUi?.(),
      })
      this.showToast('Vista y filtros restablecidos', false)
      addActivityLog('Explorador restablecido (cámara, búsqueda, filtros).', 'info')
    }

    document.getElementById('btn-reset')!.addEventListener('click', () => {
      this.explorerActions.reset()
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !(e.target instanceof HTMLInputElement)
        && !(e.target instanceof HTMLTextAreaElement)
        && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault()
        this.explorerActions.reset()
      }
    })

    this.engine.onMinimapTick = () => this.minimap.update()
    this.engine.onStop = () => this.minimap.invalidateBounds()

    this.search.setup(graph.nodes)
    this.minimap.setStructure(this.overviewStructure)
    this.minimap.update()
    this.viewOptions.renderList()
    this.coverageMap?.refreshCapBanner()

    this.agentLensBar = initAgentLensBar({
      engine: this.engine,
      showToast: (msg, isError) => this.showToast(msg, isError),
      selectNode: (id, delay) => this.panel.selectNode(id, delay),
      enterAgentFocus: this.focus.enterAgentFocus,
    })

    initIndexTour({
      engine: this.engine,
      showToast: (msg, isError) => this.showToast(msg, isError),
      selectNode: (id, delay) => this.panel.selectNode(id, delay),
      getDefaultWorkspace: () => this.overview?.top_workspaces?.[0]?.workspace ?? null,
    })

    this.unsubscribeUpdates = subscribeToUpdates((updated, event) => {
      this.onGraphUpdate(updated, event)
    })
    window.addEventListener('beforeunload', () => this.destroy())
  }

  private showError(msg: string, err?: Error): void {
    this.loadingText.style.display = 'none'
    ;(this.loadingEl.querySelector('.spinner') as HTMLElement).style.display = 'none'
    this.loadingErr.style.display = 'block'
    this.loadingErr.textContent = msg
    if (err) console.error(msg, err)
  }

  private showToast(msg: string, isError = false): void {
    const toast = document.getElementById('info-msg')!
    toast.textContent = msg
    toast.style.color = isError ? '#ef5350' : '#4fc3f7'
    setTimeout(() => { toast.textContent = ''; toast.style.color = '' }, 4000)
  }
}
