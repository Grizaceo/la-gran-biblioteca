import type { Graph } from '../lib/bridge'
import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import {
  loadViewPrefs,
  saveViewPrefs,
  type LayoutMode,
} from '../render3d/viewPrefs'
import {
  confirmPref,
  loadCatalog,
  loadPrefs,
  triggerConstellationRelayout,
} from '../services/constellationService'
import {
  BANNER_LAYOUT_ON_NO_CONFIRMED,
  CONSTELLATION_INTRO_NOTE,
  CONSTELLATION_LAYOUT_TOGGLE,
  CONSTELLATION_PANEL_TITLE,
  CONSTELLATION_RECALC_BTN,
  TOAST_CONFIRM_WITHOUT_LAYOUT,
  constellationLayoutMenuLabel,
} from './constellationCopy'
import { findFolderNodeId, flyCameraToNode } from './constellationFlyTo'
import { openConstellationPickerModal } from './constellationPicker'

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function folderLabelFromPath(folderPath: string): string {
  const parts = folderPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || folderPath
}

export interface ConstellationSettingsAPI {
  openPanel: () => void
  closePanel: () => void
  isLayoutEnabled: () => boolean
  setLayoutEnabled: (enabled: boolean) => void
  syncMenuLabel: () => void
  renderPanel: () => Promise<void>
  notifyConfirmedWithoutLayout: () => void
}

export function initConstellationSettings(
  engine: Graph3DEngine,
  showToast?: (msg: string, isError?: boolean) => void,
  getCurrentGraph?: () => Graph | null,
): ConstellationSettingsAPI {
  const panel = document.getElementById('constellation-panel')
  const body = document.getElementById('constellation-panel-body')
  const closeBtn = document.getElementById('constellation-panel-close')
  const titleEl = document.getElementById('constellation-panel-title')

  if (titleEl) titleEl.textContent = CONSTELLATION_PANEL_TITLE

  if (!panel || !body) {
    return {
      openPanel: () => {},
      closePanel: () => {},
      isLayoutEnabled: () => false,
      setLayoutEnabled: () => {},
      syncMenuLabel: () => {},
      renderPanel: async () => {},
      notifyConfirmedWithoutLayout: () => {},
    }
  }

  let catalogCache: Array<{ id: string; name: string; name_es?: string; star_count?: number }> | null =
    null

  async function getCatalog() {
    if (!catalogCache) catalogCache = await loadCatalog()
    return catalogCache
  }

  function isLayoutEnabled(): boolean {
    return loadViewPrefs().layoutMode === 'constellation'
  }

  function setLayoutEnabled(enabled: boolean): void {
    const mode: LayoutMode = enabled ? 'constellation' : 'tree'
    saveViewPrefs({ ...loadViewPrefs(), layoutMode: mode })
    engine.setLayoutMode(mode)
    syncMenuLabel()
  }

  function syncMenuLabel(): void {
    const el = document.getElementById('menu-opt-constellation-layout')
    if (!el) return
    el.textContent = constellationLayoutMenuLabel(isLayoutEnabled())
  }

  function notifyConfirmedWithoutLayout(): void {
    if (!isLayoutEnabled()) {
      showToast?.(TOAST_CONFIRM_WITHOUT_LAYOUT)
    }
  }

  function closePanel(): void {
    panel!.classList.remove('active')
  }

  function flyToFolder(folderPath: string): void {
    const nodeId = findFolderNodeId(getCurrentGraph?.() ?? null, folderPath)
    if (!nodeId) {
      showToast?.('No se encontró la carpeta en el grafo actual', true)
      return
    }
    if (!flyCameraToNode(engine.fg, nodeId)) {
      showToast?.('No se pudo centrar la cámara', true)
    }
  }

  async function openConstellationPicker(folderPath: string, currentId?: string): Promise<void> {
    const catalog = await getCatalog()
    openConstellationPickerModal(
      catalog,
      folderLabelFromPath(folderPath),
      currentId,
      async (cid) => {
        await confirmPref(folderPath, cid)
        notifyConfirmedWithoutLayout()
        showToast?.('Constelación guardada')
        await renderPanel()
      },
    )
  }

  async function renderPanel(): Promise<void> {
    const layoutOn = isLayoutEnabled()
    let pending: Array<{
      folder_path: string
      constellation_id: string
      status: string
    }> = []
    let allPrefs: typeof pending = []

    try {
      const prefData = await loadPrefs()
      pending = prefData.pending || []
      allPrefs = prefData.prefs || []
    } catch {
      pending = []
      allPrefs = []
    }

    await getCatalog()
    const confirmed = allPrefs.filter((p) => p.status === 'confirmed')

    let html = `<p class="constellation-intro">
      Opcional. Por defecto el grafo usa el layout de árbol. Activa las constelaciones para colocar
      subárboles de carpetas según patrones astronómicos reales (IAU).
      <br><em>${escapeHtml(CONSTELLATION_INTRO_NOTE)}</em>
    </p>
    <label class="constellation-toggle-row">
      <input type="checkbox" class="cs-layout-enable" ${layoutOn ? 'checked' : ''}>
      <span>${escapeHtml(CONSTELLATION_LAYOUT_TOGGLE)}</span>
    </label>`

    if (layoutOn && confirmed.length === 0) {
      html += `<div class="constellation-banner">${escapeHtml(BANNER_LAYOUT_ON_NO_CONFIRMED)}</div>`
    }

    if (layoutOn) {
      html += `<div class="constellation-section-title">Sugerencias pendientes</div>`
      if (!pending.length) {
        html += `<p class="constellation-hint">No hay sugerencias. Asigna constelaciones desde el detalle de una carpeta.</p>`
      } else {
        for (const p of pending) {
          const label = folderLabelFromPath(p.folder_path)
          const cname = (catalogCache || []).find((x) => x.id === p.constellation_id)?.name_es
            || (catalogCache || []).find((x) => x.id === p.constellation_id)?.name
            || p.constellation_id
          html += `<div class="constellation-pending-row">
            <span class="constellation-pending-label">${escapeHtml(label)} → ${escapeHtml(cname)}</span>
            <button type="button" class="cs-confirm-pref" data-folder="${escapeHtml(p.folder_path)}" data-cid="${escapeHtml(p.constellation_id)}">Confirmar</button>
            <button type="button" class="cs-change-pref" data-folder="${escapeHtml(p.folder_path)}" data-cid="${escapeHtml(p.constellation_id)}">Cambiar</button>
          </div>`
        }
      }

      html += `<div class="constellation-section-title">Asignaciones confirmadas (${confirmed.length})</div>`
      if (!confirmed.length) {
        html += `<p class="constellation-hint">Ninguna carpeta confirmada aún.</p>`
      } else {
        html += `<ul class="constellation-confirmed-list">`
        for (const p of confirmed.slice(0, 20)) {
          const cn = (catalogCache || []).find((x) => x.id === p.constellation_id)
          const cname = cn ? (cn.name_es || cn.name) : p.constellation_id
          html += `<li><button type="button" class="cs-fly-confirmed" data-folder="${escapeHtml(p.folder_path)}">${escapeHtml(folderLabelFromPath(p.folder_path))} — ${escapeHtml(cname)}</button></li>`
        }
        html += `</ul>`
        if (confirmed.length > 20) {
          html += `<p class="constellation-hint">+${confirmed.length - 20} más</p>`
        }
      }

      html += `<div class="constellation-actions">
        <button type="button" class="constellation-btn" id="cs-relayout">${escapeHtml(CONSTELLATION_RECALC_BTN)}</button>
      </div>`
    }

    body!.innerHTML = html
    bindPanelHandlers()
  }

  function bindPanelHandlers(): void {
    const layoutCb = body!.querySelector('.cs-layout-enable') as HTMLInputElement | null
    layoutCb?.addEventListener('change', (e) => {
      setLayoutEnabled((e.target as HTMLInputElement).checked)
      void renderPanel()
    })

    body!.querySelectorAll('.cs-confirm-pref').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const el = btn as HTMLButtonElement
        const folder = el.dataset.folder
        const cid = el.dataset.cid
        if (!folder || !cid) return
        try {
          await confirmPref(folder, cid)
          notifyConfirmedWithoutLayout()
          showToast?.('Sugerencia confirmada')
          await renderPanel()
        } catch (err) {
          showToast?.(`Error: ${(err as Error).message}`, true)
        }
      })
    })

    body!.querySelectorAll('.cs-change-pref').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const el = btn as HTMLButtonElement
        if (!el.dataset.folder) return
        await openConstellationPicker(el.dataset.folder, el.dataset.cid)
      })
    })

    body!.querySelectorAll('.cs-fly-confirmed').forEach((btn) => {
      btn.addEventListener('click', () => {
        const folder = (btn as HTMLButtonElement).dataset.folder
        if (folder) flyToFolder(folder)
      })
    })

    const relayoutBtn = document.getElementById('cs-relayout')
    relayoutBtn?.addEventListener('click', async () => {
      try {
        await triggerConstellationRelayout()
        showToast?.('Layout recalculado')
      } catch (err) {
        showToast?.(`Error: ${(err as Error).message}`, true)
      }
    })
  }

  closeBtn?.addEventListener('click', closePanel)

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (
      !t.closest('#constellation-panel')
      && !t.closest('#menu-constellations')
      && !t.closest('[data-action="open-constellation-settings"]')
      && !t.closest('.constellation-picker-overlay')
    ) {
      closePanel()
    }
  })

  syncMenuLabel()

  return {
    openPanel() {
      void renderPanel().then(() => panel!.classList.add('active'))
    },
    closePanel,
    isLayoutEnabled,
    setLayoutEnabled,
    syncMenuLabel,
    renderPanel,
    notifyConfirmedWithoutLayout,
  }
}
