import type { ConstellationCatalogEntry } from '../lib/api/types'
import { CONSTELLATION_EXPERIMENTAL } from './constellationCopy'

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function openConstellationPickerModal(
  catalog: ConstellationCatalogEntry[],
  folderLabel: string,
  currentId: string | undefined,
  onSelect: (constellationId: string) => void | Promise<void>,
): void {
  const overlay = document.createElement('div')
  overlay.className = 'constellation-picker-overlay active'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')

  const dialog = document.createElement('div')
  dialog.className = 'constellation-picker-dialog'
  dialog.innerHTML = `
    <div class="constellation-picker-header">
      <h3>Constelación${escapeHtml(CONSTELLATION_EXPERIMENTAL)}</h3>
      <button type="button" class="constellation-picker-close" aria-label="Cerrar">&times;</button>
    </div>
    <p class="constellation-picker-sub">Carpeta: <strong>${escapeHtml(folderLabel)}</strong></p>
    <input type="search" class="constellation-picker-search" placeholder="Buscar por nombre (es/en) o id…" autocomplete="off" />
    <div class="constellation-picker-preview" id="cp-preview"></div>
    <ul class="constellation-picker-list" id="cp-list"></ul>
    <div class="constellation-picker-actions">
      <button type="button" class="constellation-picker-cancel">Cancelar</button>
    </div>`

  overlay.appendChild(dialog)
  document.body.appendChild(overlay)

  const searchInput = dialog.querySelector('.constellation-picker-search') as HTMLInputElement
  const listEl = dialog.querySelector('#cp-list') as HTMLUListElement
  const previewEl = dialog.querySelector('#cp-preview') as HTMLDivElement
  let selectedId = currentId || catalog[0]?.id || ''

  function renderPreview(id: string): void {
    const c = catalog.find((x) => x.id === id)
    if (!c) {
      previewEl.textContent = ''
      return
    }
    previewEl.innerHTML = `<span class="cp-id">${escapeHtml(c.id)}</span> · ${escapeHtml(c.name_es || c.name)} · ${c.star_count} estrellas`
  }

  function renderList(query: string): void {
    const q = query.trim().toLowerCase()
    const filtered = catalog.filter((c) => {
      if (!q) return true
      const hay = `${c.id} ${c.name} ${c.name_es || ''}`.toLowerCase()
      return hay.includes(q)
    })
    listEl.innerHTML = filtered
      .slice(0, 80)
      .map((c) => {
        const sel = c.id === selectedId ? ' selected' : ''
        return `<li><button type="button" class="constellation-picker-item${sel}" data-id="${escapeHtml(c.id)}">
          <span class="cp-item-name">${escapeHtml(c.name_es || c.name)}</span>
          <span class="cp-item-id">${escapeHtml(c.id)}</span>
        </button></li>`
      })
      .join('')

    listEl.querySelectorAll('.constellation-picker-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLButtonElement).dataset.id
        if (!id) return
        selectedId = id
        renderPreview(id)
        close()
        await onSelect(id)
      })
    })
  }

  function close(): void {
    overlay.remove()
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value))
  dialog.querySelector('.constellation-picker-close')?.addEventListener('click', close)
  dialog.querySelector('.constellation-picker-cancel')?.addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })

  renderPreview(selectedId)
  renderList('')
  searchInput.focus()
}
