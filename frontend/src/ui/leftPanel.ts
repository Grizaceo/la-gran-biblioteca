import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import type { OverviewStructure, StructureCluster } from '../lib/bridge'
import { fetchCoverage } from '../lib/bridge'
import { clusterToLens, lensToGraphFilters, type ExplorationLens } from '../lib/lens'
import { saveHeatmapMode, type HeatmapMode, type StudyFilter } from '../render3d/viewPrefs'
import { flyToCluster } from '../render3d/ui/structureNav'
import { getPanelDock } from './panelDock'

const STORAGE_OPEN = 'lgb.leftPanelOpen'

export interface LeftPanelHooks {
  engine: Graph3DEngine
  forceGraph: {
    graphData(): { nodes: Array<Record<string, unknown>> }
    cameraPosition(
      to: { x: number; y: number; z: number },
      lookAt?: Record<string, unknown> | null,
      duration?: number
    ): unknown
  }
  showToast: (msg: string, isError?: boolean) => void
  getGraphTotal?: () => number | undefined
  getGraphShown?: () => number | undefined
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
}

function applyLensToEngine(engine: Graph3DEngine, lens: ExplorationLens): void {
  engine.setGraphFilters(lensToGraphFilters(lens))
  engine.setHeatmapMode(lens.heatmap || 'off')
  saveHeatmapMode(lens.heatmap || 'off')
}

function renderSummaryCard(
  mode: 'workspace' | 'folder',
  cluster: StructureCluster,
  maxDegreeSum: number
): string {
  const ratio = cluster.study_ratio ?? (
    cluster.count ? (cluster.studied_count || 0) / cluster.count : 0
  )
  const pct = Math.round(ratio * 100)
  const volPct = Math.min(
    100,
    Math.round(((cluster.degree_sum || 0) / Math.max(maxDegreeSum, 1)) * 100)
  )
  return `<button type="button" class="leftpanel-card" data-mode="${mode}" data-key="${escapeHtml(cluster.key)}">
    <div class="leftpanel-card-title">${escapeHtml(cluster.label || cluster.key)}</div>
    <div class="leftpanel-card-stats">${cluster.count || 0} nodos · estudio ${pct}% · grado Ø${cluster.avg_degree ?? '—'}</div>
    <div class="leftpanel-bar-track">
      <div class="leftpanel-bar-study" style="width:${pct}%"></div>
      <div class="leftpanel-bar-volume" style="width:${volPct}%"></div>
    </div>
  </button>`
}

export function initLeftPanel(hooks: LeftPanelHooks): {
  refresh: () => void
  refreshCapBanner: () => void
  destroy: () => void
} {
  const panel = document.getElementById('left-panel')
  const body = document.getElementById('left-panel-body')
  const capBanner = document.getElementById('cap-banner')
  const dock = getPanelDock()

  let coverageData: OverviewStructure | null = null
  let loaded = false
  let typeStatsCache: Array<{ type: string; count: number; color: string }> = []

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
      capBanner.textContent = `Mostrando ${shown} de ${total} nodos (cap 1000). Abre Filtros para orientarte.`
      capBanner.title = 'El bridge limita el grafo HTTP; el MCP ve el grafo completo en DB.'
    } else {
      capBanner.classList.remove('active')
      capBanner.textContent = ''
    }
  }

  async function ensureCoverageLoaded(): Promise<void> {
    if (loaded && coverageData) return
    try {
      coverageData = await fetchCoverage()
      loaded = true
      renderBody()
    } catch (err) {
      if (body) body.innerHTML = `<div class="leftpanel-hint">Error cargando cobertura: ${escapeHtml((err as Error).message)}</div>`
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
      1
    )

    let html = ''

    // --- SECCIÓN 1: Filtros rápidos ---
    html += `
      <div class="leftpanel-section">
        <label class="leftpanel-label">🔍 Buscar workspace/carpeta/tema</label>
        <input type="search" id="leftpanel-search" class="leftpanel-search" placeholder="Filtrar lista..." aria-label="Filtrar workspaces y carpetas">
      </div>
    `

    // --- SECCIÓN 2: Workspace filters ---
    html += `
      <div class="leftpanel-section">
        <div class="leftpanel-section-header">
          <span>📂 Workspaces</span>
          <button type="button" id="leftpanel-ws-all" class="leftpanel-btn-subtle" title="Seleccionar todos">Todos</button>
          <button type="button" id="leftpanel-ws-none" class="leftpanel-btn-subtle" title="Deseleccionar todos">Ninguno</button>
        </div>
        <div id="leftpanel-ws-list" class="leftpanel-checklist">
    `
    const currentWsFilters = hooks.engine.getGraphFilters().workspaces || []
    for (const ws of workspaces) {
      const checked = !currentWsFilters.length || currentWsFilters.includes(ws.key)
      html += `<label class="leftpanel-check-item"><input type="checkbox" value="${escapeHtml(ws.key)}" ${checked ? 'checked' : ''}> ${escapeHtml(ws.label || ws.key)} <span class="leftpanel-count">${ws.count || 0}</span></label>`
    }
    html += `</div></div>`

    // --- SECCIÓN 3: Folder filters (top 30) ---
    const allFolders = [...(coverageData.modes?.folder || [])]
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 30)
    const currentFolderFilters = hooks.engine.getGraphFilters().folders || []
    html += `
      <div class="leftpanel-section">
        <div class="leftpanel-section-header">
          <span>📁 Carpetas principales</span>
          <button type="button" id="leftpanel-fld-all" class="leftpanel-btn-subtle">Todos</button>
          <button type="button" id="leftpanel-fld-none" class="leftpanel-btn-subtle">Ninguno</button>
        </div>
        <div id="leftpanel-fld-list" class="leftpanel-checklist">
    `
    for (const fld of allFolders) {
      const checked = !currentFolderFilters.length || currentFolderFilters.includes(fld.key)
      html += `<label class="leftpanel-check-item"><input type="checkbox" value="${escapeHtml(fld.key)}" ${checked ? 'checked' : ''}> ${escapeHtml(fld.label || fld.key)} <span class="leftpanel-count">${fld.count || 0}</span></label>`
    }
    html += `</div></div>`

    // --- SECCIÓN 4: Topic filters ---
    const topics = [...(coverageData.modes?.topic || [])]
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 30)
    const currentTopicFilters = hooks.engine.getGraphFilters().topics || []
    if (topics.length) {
      html += `
        <div class="leftpanel-section">
          <div class="leftpanel-section-header">
            <span>🏷️ Temas</span>
            <button type="button" id="leftpanel-topic-all" class="leftpanel-btn-subtle">Todos</button>
            <button type="button" id="leftpanel-topic-none" class="leftpanel-btn-subtle">Ninguno</button>
          </div>
          <div id="leftpanel-topic-list" class="leftpanel-checklist">
      `
      for (const t of topics) {
        const checked = !currentTopicFilters.length || currentTopicFilters.includes(t.key)
        html += `<label class="leftpanel-check-item"><input type="checkbox" value="${escapeHtml(t.key)}" ${checked ? 'checked' : ''}> ${escapeHtml(t.label || t.key)} <span class="leftpanel-count">${t.count || 0}</span></label>`
      }
      html += `</div></div>`
    }

    // --- SECCIÓN 5: Heatmap + Study filter + Min degree ---
    const gf = hooks.engine.getGraphFilters()
    const heatmapMode = hooks.engine.getHeatmapMode()
    html += `
      <div class="leftpanel-section">
        <div class="leftpanel-section-header"><span>📊 Heatmap</span></div>
        <div class="leftpanel-radio-group" role="radiogroup" aria-label="Modo heatmap">
          <label><input type="radio" name="heatmap" value="off" ${heatmapMode === 'off' ? 'checked' : ''}> Off</label>
          <label><input type="radio" name="heatmap" value="volume" ${heatmapMode === 'volume' ? 'checked' : ''}> Volumen (grado)</label>
          <label><input type="radio" name="heatmap" value="study" ${heatmapMode === 'study' ? 'checked' : ''}> Estudio</label>
        </div>
      </div>

      <div class="leftpanel-section">
        <div class="leftpanel-section-header"><span>🎯 Filtro estudio</span></div>
        <div class="leftpanel-radio-group" role="radiogroup" aria-label="Filtro por estado de estudio">
          <label><input type="radio" name="studyFilter" value="all" ${gf.studyFilter === 'all' ? 'checked' : ''}> Todos</label>
          <label><input type="radio" name="studyFilter" value="studied" ${gf.studyFilter === 'studied' ? 'checked' : ''}> Estudiados</label>
          <label><input type="radio" name="studyFilter" value="unstudied" ${gf.studyFilter === 'unstudied' ? 'checked' : ''}> No estudiados</label>
        </div>
      </div>

      <div class="leftpanel-section">
        <div class="leftpanel-section-header"><span>🔗 Grado mínimo: <span id="leftpanel-mindeg-val">${gf.minDegree || 0}</span></span></div>
        <input type="range" id="leftpanel-mindeg" min="0" max="20" value="${gf.minDegree || 0}" class="leftpanel-slider" aria-label="Grado mínimo">
      </div>
    `

    // --- SECCIÓN 6: Type visibility ---
    html += `
      <div class="leftpanel-section">
        <div class="leftpanel-section-header"><span>👁️ Tipos de nodo</span></div>
        <div id="leftpanel-types-list" class="leftpanel-checklist">
    `
    const hiddenTypes = hooks.engine.hiddenTypes
    for (const ts of typeStatsCache) {
      const visible = !hiddenTypes.has(ts.type)
      html += `<label class="leftpanel-check-item leftpanel-type-item"><span class="leftpanel-type-dot" style="background:${ts.color}"></span><input type="checkbox" value="${escapeHtml(ts.type)}" ${visible ? 'checked' : ''}> ${escapeHtml(ts.type)} <span class="leftpanel-count">${ts.count}</span></label>`
    }
    html += `</div></div>`

    // --- SECCIÓN 7: Summary cards (cobertura) ---
    html += `<div class="leftpanel-section"><div class="leftpanel-section-header"><span>📈 Resumen cobertura</span></div>`
    html += `<div class="leftpanel-cards" id="leftpanel-cards-ws">`
    html += workspaces.map((c) => renderSummaryCard('workspace', c, maxDeg)).join('')
    html += `</div>`
    html += `<div class="leftpanel-cards" id="leftpanel-cards-fld">`
    html += folders.map((c) => renderSummaryCard('folder', c, maxDeg)).join('')
    html += `</div></div>`

    body!.innerHTML = html

    // --- Event listeners ---
    // Search filter for lists
    const searchInput = document.getElementById('leftpanel-search') as HTMLInputElement
    searchInput?.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase()
      document.querySelectorAll('#leftpanel-ws-list .leftpanel-check-item, #leftpanel-fld-list .leftpanel-check-item, #leftpanel-topic-list .leftpanel-check-item').forEach((el) => {
        const text = el.textContent?.toLowerCase() || ''
        ;(el as HTMLElement).style.display = text.includes(q) ? '' : 'none'
      })
    })

    // Workspace checkboxes
    document.querySelectorAll('#leftpanel-ws-list input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => applyWorkspaceFilters())
    })
    document.getElementById('leftpanel-ws-all')?.addEventListener('click', () => setAllCheckboxes('#leftpanel-ws-list', true))
    document.getElementById('leftpanel-ws-none')?.addEventListener('click', () => setAllCheckboxes('#leftpanel-ws-list', false))

    // Folder checkboxes
    document.querySelectorAll('#leftpanel-fld-list input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => applyFolderFilters())
    })
    document.getElementById('leftpanel-fld-all')?.addEventListener('click', () => setAllCheckboxes('#leftpanel-fld-list', true))
    document.getElementById('leftpanel-fld-none')?.addEventListener('click', () => setAllCheckboxes('#leftpanel-fld-list', false))

    // Topic checkboxes
    document.querySelectorAll('#leftpanel-topic-list input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => applyTopicFilters())
    })
    document.getElementById('leftpanel-topic-all')?.addEventListener('click', () => setAllCheckboxes('#leftpanel-topic-list', true))
    document.getElementById('leftpanel-topic-none')?.addEventListener('click', () => setAllCheckboxes('#leftpanel-topic-list', false))

    // Heatmap radios
    document.querySelectorAll('input[name="heatmap"]').forEach((r) => {
      r.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement
        hooks.engine.setHeatmapMode(target.value as HeatmapMode)
      })
    })

    // Study filter radios
    document.querySelectorAll('input[name="studyFilter"]').forEach((r) => {
      r.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement
        hooks.engine.setGraphFilters({ studyFilter: target.value as StudyFilter })
      })
    })

    // Min degree slider
    const minDegSlider = document.getElementById('leftpanel-mindeg') as HTMLInputElement
    const minDegVal = document.getElementById('leftpanel-mindeg-val')
    minDegSlider?.addEventListener('input', () => {
      const val = parseInt(minDegSlider.value, 10)
      if (minDegVal) minDegVal.textContent = String(val)
    })
    minDegSlider?.addEventListener('change', () => {
      hooks.engine.setGraphFilters({ minDegree: parseInt(minDegSlider.value, 10) })
    })

    // Type checkboxes
    document.querySelectorAll('#leftpanel-types-list input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement
        hooks.engine.setTypeVisible(target.value, target.checked)
      })
    })

    // Summary cards click -> apply lens + fly
    document.querySelectorAll('.leftpanel-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') as 'workspace' | 'folder'
        const key = btn.getAttribute('data-key') || ''
        const cluster = (mode === 'workspace' ? workspaces : folders).find((c) => c.key === key)
        if (!cluster) return
        const lens = clusterToLens(mode, cluster.key, cluster.label || cluster.key, 'study')
        applyLensToEngine(hooks.engine, lens)
        flyToCluster(hooks.forceGraph, hooks.engine, cluster)
        hooks.showToast(`Lens: ${cluster.label || cluster.key}`, false)
      })
    })
  }

  function setAllCheckboxes(selector: string, checked: boolean): void {
    document.querySelectorAll(`${selector} input[type="checkbox"]`).forEach((cb) => {
      ;(cb as HTMLInputElement).checked = checked
    })
    // Trigger change on first to apply
    const first = document.querySelector(`${selector} input[type="checkbox"]`) as HTMLInputElement
    if (first) first.dispatchEvent(new Event('change'))
  }

  function applyWorkspaceFilters(): void {
    const vals = Array.from(document.querySelectorAll('#leftpanel-ws-list input[type="checkbox"]:checked'))
      .map((cb) => (cb as HTMLInputElement).value)
    hooks.engine.setGraphFilters({ workspaces: vals.length ? vals : null })
  }

  function applyFolderFilters(): void {
    const vals = Array.from(document.querySelectorAll('#leftpanel-fld-list input[type="checkbox"]:checked'))
      .map((cb) => (cb as HTMLInputElement).value)
    hooks.engine.setGraphFilters({ folders: vals.length ? vals : null })
  }

  function applyTopicFilters(): void {
    const vals = Array.from(document.querySelectorAll('#leftpanel-topic-list input[type="checkbox"]:checked'))
      .map((cb) => (cb as HTMLInputElement).value)
    hooks.engine.setGraphFilters({ topics: vals.length ? vals : null })
  }

  function refresh(): void {
    typeStatsCache = hooks.engine.getTypeStats()
    loaded = false
    coverageData = null
    if (panel?.classList.contains('is-open')) {
      void ensureCoverageLoaded()
    }
  }

  if (!panel) {
    return { refresh, refreshCapBanner, destroy: () => {} }
  }

  dock.register({
    id: 'filters',
    element: panel,
    triggers: ['#btn-filters-panel'],
    onOpen: () => {
      persistOpen(true)
      refresh()
      void ensureCoverageLoaded()
    },
    onClose: () => persistOpen(false),
  })

  capBanner?.addEventListener('click', () => {
    dock.open('filters')
    refresh()
    void ensureCoverageLoaded()
  })

  if (panelOpen()) {
    dock.open('filters')
    refresh()
    void ensureCoverageLoaded()
  }

  return { refresh, refreshCapBanner, destroy: () => {} }
}