import { loadGraphFilters, saveGraphFilters, DEFAULT_GRAPH_FILTERS } from '../viewPrefs.ts'

const EDGE_TYPES = ['co-located', 'tagged', 'contains', 'references']

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function initViewOptions(engine) {
  const panel = document.getElementById('view-options-panel')
  const list = document.getElementById('view-options-list')
  if (!panel || !list) return { renderList: () => {} }

  engine.setGraphFilters(loadGraphFilters())

  function renderList() {
    const filters = engine.getGraphFilters()
    const workspaces = engine.getWorkspaceList()

    let html = `<div class="vo-section">Workspaces</div>`
    if (!workspaces.length) {
      html += `<div class="vo-hint">Sin workspaces detectados</div>`
    } else {
      const allOn = !filters.workspaces || filters.workspaces.length === workspaces.length
      html += `<label class="vo-item">
        <input type="checkbox" class="vo-ws-all" ${allOn ? 'checked' : ''}>
        <span>Todos</span>
      </label>`
      for (const ws of workspaces) {
        const checked = allOn || (filters.workspaces || []).includes(ws)
        html += `<label class="vo-item">
          <input type="checkbox" class="vo-ws" data-ws="${ws}" ${checked ? 'checked' : ''}>
          <span>${escapeHtml(ws)}</span>
        </label>`
      }
    }

    html += `<div class="vo-section">Estudio</div>
      <label class="vo-item">
        <span>Filtrar por estudio</span>
        <select class="vo-study" id="vo-study-filter">
          <option value="all" ${filters.studyFilter === 'all' ? 'selected' : ''}>Todos</option>
          <option value="studied" ${filters.studyFilter === 'studied' ? 'selected' : ''}>Solo estudiados</option>
          <option value="unstudied" ${filters.studyFilter === 'unstudied' ? 'selected' : ''}>Sin estudiar</option>
        </select>
      </label>`

    html += `<div class="vo-section">Nodos</div>
      <label class="vo-item">
        <input type="checkbox" class="vo-hide-tags" ${filters.hideTags ? 'checked' : ''}>
        <span>Ocultar nodos #tag</span>
      </label>
      <label class="vo-item">
        <input type="checkbox" class="vo-show-archived" ${filters.showArchived ? 'checked' : ''}>
        <span>Mostrar carpetas archive (bóveda)</span>
      </label>
      <label class="vo-item">
        <span>Grado mínimo (hubs)</span>
        <input type="number" class="vo-min-degree" min="0" max="50" value="${filters.minDegree}" style="width:48px">
      </label>`

    html += `<div class="vo-section">Tipos de arista</div>`
    for (const et of EDGE_TYPES) {
      const hidden = filters.hiddenEdgeTypes.includes(et)
      html += `<label class="vo-item">
        <input type="checkbox" class="vo-edge" data-edge="${et}" ${hidden ? '' : 'checked'}>
        <span>${et}</span>
      </label>`
    }

    list.innerHTML = html
    bindHandlers(workspaces)
  }

  function persist() {
    saveGraphFilters(engine.getGraphFilters())
  }

  function bindHandlers(workspaces) {
    const allBox = list.querySelector('.vo-ws-all')
    if (allBox) {
      allBox.addEventListener('change', (e) => {
        engine.setGraphFilters({ workspaces: e.target.checked ? null : [] })
        persist()
        renderList()
      })
    }

    list.querySelectorAll('.vo-ws').forEach((cb) => {
      cb.addEventListener('change', () => {
        const selected = [...list.querySelectorAll('.vo-ws')]
          .filter((x) => x.checked)
          .map((x) => x.dataset.ws)
        engine.setGraphFilters({
          workspaces: selected.length === workspaces.length ? null : selected,
        })
        persist()
        const all = list.querySelector('.vo-ws-all')
        if (all) all.checked = selected.length === workspaces.length
      })
    })

    const studySel = list.querySelector('.vo-study')
    if (studySel) {
      studySel.addEventListener('change', (e) => {
        engine.setGraphFilters({ studyFilter: e.target.value })
        persist()
      })
    }

    const hideTags = list.querySelector('.vo-hide-tags')
    if (hideTags) {
      hideTags.addEventListener('change', (e) => {
        engine.setGraphFilters({ hideTags: e.target.checked })
        persist()
      })
    }

    const showArchived = list.querySelector('.vo-show-archived')
    if (showArchived) {
      showArchived.addEventListener('change', (e) => {
        engine.setGraphFilters({ showArchived: e.target.checked })
        persist()
      })
    }

    const minDeg = list.querySelector('.vo-min-degree')
    if (minDeg) {
      minDeg.addEventListener('change', (e) => {
        engine.setGraphFilters({ minDegree: Math.max(0, parseInt(e.target.value, 10) || 0) })
        persist()
      })
    }

    list.querySelectorAll('.vo-edge').forEach((cb) => {
      cb.addEventListener('change', () => {
        const hidden = [...list.querySelectorAll('.vo-edge')]
          .filter((x) => !x.checked)
          .map((x) => x.dataset.edge)
        engine.setGraphFilters({ hiddenEdgeTypes: hidden })
        persist()
      })
    })
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#view-options-panel') && !e.target.closest('[data-action="toggle-view-options"]')) {
      panel.classList.remove('active')
    }
  })

  return {
    renderList,
    openPanel() {
      renderList()
      panel.classList.add('active')
    },
    resetFilters() {
      engine.setGraphFilters({ ...DEFAULT_GRAPH_FILTERS })
      saveGraphFilters(DEFAULT_GRAPH_FILTERS)
      renderList()
    },
  }
}
