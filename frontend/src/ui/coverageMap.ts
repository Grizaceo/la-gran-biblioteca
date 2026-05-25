import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import type { OverviewStructure, StructureCluster } from '../lib/bridge'
import { fetchCoverage } from '../lib/bridge'
import { clusterToLens, lensToGraphFilters, type ExplorationLens } from '../lib/lens'
import { saveHeatmapMode } from '../render3d/viewPrefs'
import { flyToCluster } from '../render3d/ui/structureNav'
import { getPanelDock } from './panelDock'

const STORAGE_OPEN = 'lgb.coveragePanelOpen'

export interface CoverageMapHooks {
  engine: Graph3DEngine
  forceGraph: {
    graphData(): { nodes: Array<Record<string, unknown>> }
    cameraPosition(
      to: { x: number; y: number; z: number },
      lookAt?: Record<string, unknown> | null,
      duration?: number,
    ): unknown
  }
  showToast: (msg: string, isError?: boolean) => void
  getGraphTotal?: () => number | undefined
  getGraphShown?: () => number | undefined
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function applyLensToEngine(engine: Graph3DEngine, lens: ExplorationLens): void {
  engine.setGraphFilters(lensToGraphFilters(lens))
  engine.setHeatmapMode(lens.heatmap || 'off')
  saveHeatmapMode(lens.heatmap || 'off')
  const legend = document.getElementById('heatmap-legend')
  if (legend) legend.classList.toggle('active', lens.heatmap !== 'off')
}

function renderClusterCard(
  mode: 'workspace' | 'folder',
  cluster: StructureCluster,
  maxDegreeSum: number,
): string {
  const ratio = cluster.study_ratio ?? (
    cluster.count ? (cluster.studied_count || 0) / cluster.count : 0
  )
  const pct = Math.round(ratio * 100)
  const volPct = Math.min(
    100,
    Math.round(((cluster.degree_sum || 0) / Math.max(maxDegreeSum, 1)) * 100),
  )
  return `<button type="button" class="coverage-card" data-mode="${mode}" data-key="${escapeHtml(cluster.key)}">
    <div class="coverage-card-title">${escapeHtml(cluster.label || cluster.key)}</div>
    <div class="coverage-card-stats">${cluster.count || 0} nodos · estudio ${pct}% · grado Ø${cluster.avg_degree ?? '—'}</div>
    <div class="coverage-bar-track">
      <div class="coverage-bar-study" style="width:${pct}%"></div>
      <div class="coverage-bar-volume" style="width:${volPct}%"></div>
    </div>
  </button>`
}

export function initCoverageMap(hooks: CoverageMapHooks): {
  refreshCapBanner: () => void
  destroy: () => void
} {
  const panel = document.getElementById('coverage-panel')
  const body = document.getElementById('coverage-body')
  const capBanner = document.getElementById('cap-banner')
  const dock = getPanelDock()

  let coverageData: OverviewStructure | null = null
  let loaded = false

  function panelOpen(): boolean {
    try {
      return localStorage.getItem(STORAGE_OPEN) === '1'
    } catch {
      return false
    }
  }

  function persistOpen(open: boolean): void {
    try {
      localStorage.setItem(STORAGE_OPEN, open ? '1' : '0')
    } catch { /* */ }
  }

  function refreshCapBanner(): void {
    if (!capBanner) return
    const shown = hooks.getGraphShown?.() ?? 0
    const total = hooks.getGraphTotal?.() ?? shown
    if (total > shown && shown > 0) {
      capBanner.classList.add('active')
      capBanner.textContent = `Mostrando ${shown} de ${total} nodos (cap 1000). Abre Cobertura para orientarte.`
      capBanner.title = 'El bridge limita el grafo HTTP; el MCP ve el grafo completo en DB.'
    } else {
      capBanner.classList.remove('active')
      capBanner.textContent = ''
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded && coverageData) return
    try {
      coverageData = await fetchCoverage()
      loaded = true
      renderBody()
    } catch (err) {
      if (body) body.innerHTML = `<div class="coverage-hint">Error cargando cobertura: ${escapeHtml((err as Error).message)}</div>`
    }
  }

  function renderBody(): void {
    if (!body || !coverageData) return
    const workspaces = [...(coverageData.modes?.workspace || [])]
      .sort((a, b) => (b.study_ratio || 0) - (a.study_ratio || 0))
    const folders = [...(coverageData.modes?.folder || [])]
      .sort((a, b) => (a.study_ratio || 0) - (b.study_ratio || 0))
      .slice(0, 20)

    const maxDeg = Math.max(
      ...workspaces.map((c) => c.degree_sum || 0),
      ...folders.map((c) => c.degree_sum || 0),
      1,
    )
    let html = `<div class="coverage-section">Workspaces (por estudio)</div>`
    html += workspaces.map((c) => renderClusterCard('workspace', c, maxDeg)).join('')
    html += `<div class="coverage-section">Carpetas con huecos</div>`
    html += folders.map((c) => renderClusterCard('folder', c, maxDeg)).join('')

    body.innerHTML = html
    body.querySelectorAll('.coverage-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') as 'workspace' | 'folder'
        const key = btn.getAttribute('data-key') || ''
        const cluster = (mode === 'workspace' ? workspaces : folders).find((c) => c.key === key)
        if (!cluster) return
        const lens = clusterToLens(mode, cluster.key, cluster.label || cluster.key, 'study')
        applyLensToEngine(hooks.engine, lens)
        flyToCluster(hooks.forceGraph, hooks.engine, cluster)
        hooks.showToast(`Lens aplicado: ${cluster.label || cluster.key}`, false)
      })
    })
  }

  if (!panel) {
    return { refreshCapBanner, destroy: () => {} }
  }

  dock.register({
    id: 'coverage',
    element: panel,
    triggers: ['#btn-coverage-panel'],
    onOpen: () => {
      persistOpen(true)
      void ensureLoaded()
    },
    onClose: () => persistOpen(false),
  })

  capBanner?.addEventListener('click', () => {
    dock.open('coverage')
    void ensureLoaded()
  })

  if (panelOpen()) {
    dock.open('coverage')
    void ensureLoaded()
  }

  return {
    refreshCapBanner,
    destroy: () => {},
  }
}
