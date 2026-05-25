import { getPanelDock } from '../../ui/panelDock.js'

const STORAGE_KEY = 'lgb.hiddenTypes'

export function initVisibility(engine) {
  const panel = document.getElementById('visibility-panel')
  const list = document.getElementById('visibility-list')
  const dock = getPanelDock()

  const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  for (const type of persisted) engine.setTypeVisible(type, false)

  function renderList() {
    const stats = engine.getTypeStats()
    if (!stats.length) return

    let html = `<label class="vis-all">
      <input type="checkbox" id="vis-check-all" ${stats.every(s => engine.isTypeVisible(s.type)) ? 'checked' : ''}>
      <span>Todos</span>
    </label>`

    for (const { type, count, color } of stats) {
      const checked = engine.isTypeVisible(type) ? 'checked' : ''
      const escType = type.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      html += `<label class="vis-item" data-type="${escType}">
        <input type="checkbox" class="vis-check" data-type="${escType}" ${checked}>
        <span class="vis-dot" style="background:${color}"></span>
        <span class="vis-name">${escType}</span>
        <span class="vis-count">${count}</span>
      </label>`
    }
    list.innerHTML = html

    document.getElementById('vis-check-all').addEventListener('change', (e) => {
      const checked = e.target.checked
      for (const { type } of stats) engine.setTypeVisible(type, checked)
      persistState(stats)
      renderList()
    })

    list.querySelectorAll('.vis-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const type = e.target.dataset.type
        engine.setTypeVisible(type, e.target.checked)
        persistState(stats)
        const allBox = document.getElementById('vis-check-all')
        if (allBox) allBox.checked = stats.every(s => engine.isTypeVisible(s.type))
      })
    })
  }

  function persistState(stats) {
    const hidden = stats.filter(s => !engine.isTypeVisible(s.type)).map(s => s.type)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden))
  }

  dock.register({
    id: 'visibility',
    element: panel,
    triggers: ['#btn-visibility'],
    onOpen: () => renderList(),
  })

  engine.onTypesChanged = renderList

  return { renderList }
}
