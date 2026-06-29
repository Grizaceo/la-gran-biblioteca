import { Graph3DEngine } from '../render3d/Graph3DEngine'
import * as bridge from '../lib/bridge'
import { fetchVaults, switchVault, registerVaultFromPath } from '../lib/api/vaults'
import { browseDirectory } from '../lib/api/browse'
import {
  loadViewPrefs,
  saveViewPrefs,
  type QualityPreset,
  type ViewPrefs,
} from '../render3d/viewPrefs'

import type { ConstellationSettingsAPI } from './constellationSettings'
import {
  TOAST_ENABLE_LAYOUT_FIRST,
  TOAST_LAYOUT_ON_ACTIVATED,
  TOAST_RELAYOUT_OK,
  TOAST_TREE_LAYOUT,
} from './constellationCopy'
import { createModalShell } from './modals/modalShell'
import { mountFolderPicker } from './folderPicker'
import { getPanelDock } from './panelDock'
import { HELP_GUIDE_HTML, mountHelpGuideStyles } from './helpGuide'
import { syncMinimapHudLayout } from './legendDock'

export interface MenuBarOptions {
  openViewOptions?: () => void
  constellationSettings?: ConstellationSettingsAPI
  onRescanComplete?: () => void
  resetExplorer?: () => void
  onVaultSwitch?: (result: bridge.VaultSwitchResponse) => void | Promise<void>
}

export function initMenuBar(engine: Graph3DEngine, opts: MenuBarOptions = {}): void {
  // --- DOM References ---
  const menuBar = document.getElementById('menu-bar')
  const modalContainer = document.getElementById('modal-container') as HTMLElement
  const modalContent = document.getElementById('modal-content') as HTMLElement
  const modalTitle = document.getElementById('modal-title') as HTMLElement
  const modalBody = document.getElementById('modal-body') as HTMLElement
  const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLElement
  const modalCancelBtn = document.getElementById('modal-cancel-btn') as HTMLButtonElement
  const modalConfirmBtn = document.getElementById('modal-confirm-btn') as HTMLButtonElement
  const modalError = document.getElementById('modal-error') as HTMLElement

  const toast = document.getElementById('notif-toast') as HTMLElement
  const toastText = document.getElementById('notif-text') as HTMLElement

  if (!menuBar || !modalContainer || !toast) {
    console.error('[LGB menuBar] Essential DOM elements missing')
    return
  }

  // --- Premium Notification System ---
  let toastTimeout: number | null = null
  function showNotification(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    if (toastTimeout) {
      clearTimeout(toastTimeout)
    }

    toast.className = '' // reset classes
    void toast.offsetWidth // trigger reflow
    
    toast.classList.add('active', type)
    toastText.textContent = message

    toastTimeout = window.setTimeout(() => {
      toast.classList.remove('active')
    }, 4000)
  }

  // --- Dropdown Menu Click Handlers ---
  const menuItems = menuBar.querySelectorAll('.menu-item')

  menuItems.forEach((item) => {
    const trigger = item.querySelector('.menu-trigger') as HTMLElement

    trigger.addEventListener('click', (e) => {
      e.stopPropagation()

      const action = trigger.getAttribute('data-action')
      if (action) {
        handleMenuAction(action)
        closeAllMenus()
        return
      }

      const isActive = item.classList.contains('active')
      closeAllMenus()

      if (!isActive) {
        item.classList.add('active')
        trigger.setAttribute('aria-expanded', 'true')
      } else {
        trigger.setAttribute('aria-expanded', 'false')
      }
    })
  })

  // Close menus when clicking outside
  document.addEventListener('click', () => {
    closeAllMenus()
  })

  function closeAllMenus(): void {
    menuItems.forEach((item) => {
      item.classList.remove('active')
      const trigger = item.querySelector('.menu-trigger') as HTMLElement | null
      trigger?.setAttribute('aria-expanded', 'false')
    })
  }

  // --- Menu Action Router ---
  function handleMenuAction(action: string): void {
    switch (action) {
      // File actions
      case 'create-file':
        openCreateFileModal()
        break
      case 'create-folder':
        openCreateFolderModal()
        break
      case 'import-github':
        openImportGithubModal()
        break
      case 'import-arxiv':
        openImportArxivModal()
        break
      case 'import-pubmed':
        openImportPubmedModal()
        break
      case 'rescan-library':
        runRescan()
        break
      case 'open-vault':
        openAnotherVault()
        break
      case 'switch-vault':
        openSwitchVaultModal()
        break

      // View actions
      case 'focus-selected':
        document.getElementById('btn-focus')?.click()
        break
      case 'toggle-types':
        document.getElementById('btn-visibility')?.click()
        break
      case 'reset-explorer':
        opts.resetExplorer?.()
        break
      case 'show-help':
        openHelpGuideModal()
        break
      case 'toggle-starfield':
        toggleStarfieldRotation()
        break
      case 'toggle-photons':
        togglePhotonsAnimation()
        break
      case 'toggle-view-options':
        opts.openViewOptions?.()
        break
      case 'toggle-coverage':
        getPanelDock().toggle('coverage')
        break
      case 'toggle-constellation-layout':
        toggleConstellationLayout()
        break
      case 'open-constellation-settings':
        opts.constellationSettings?.openPanel()
        break
      case 'constellation-relayout':
        runConstellationRelayout()
        break
      case 'toggle-labels':
        toggleLabels()
        break
      case 'toggle-minimap':
        toggleMinimap()
        break
      case 'cycle-quality':
        cycleQuality()
        break

      // Licences action
      case 'show-licences':
        openLicencesModal()
        break
      
      default:
        console.warn(`[LGB menuBar] Unknown action: ${action}`)
    }
  }

  // Hook options click inside dropdowns
  const options = menuBar.querySelectorAll('.menu-option')
  options.forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation()
      const action = opt.getAttribute('data-action')
      if (action) {
        handleMenuAction(action)
      }
      closeAllMenus()
    })
  })

  // --- View prefs (persisted) ---
  let viewPrefs: ViewPrefs = loadViewPrefs()

  function persistViewPrefs(): void {
    saveViewPrefs(viewPrefs)
  }

  function toggleConstellationLayout(): void {
    const cs = opts.constellationSettings
    if (!cs) return
    const next = !cs.isLayoutEnabled()
    cs.setLayoutEnabled(next)
    showNotification(next ? TOAST_LAYOUT_ON_ACTIVATED : TOAST_TREE_LAYOUT, 'info')
  }

  async function runConstellationRelayout(): Promise<void> {
    if (!opts.constellationSettings?.isLayoutEnabled()) {
      showNotification(TOAST_ENABLE_LAYOUT_FIRST, 'info')
      return
    }
    try {
      await bridge.triggerConstellationRelayout()
      showNotification(TOAST_RELAYOUT_OK, 'success')
    } catch (err) {
      showNotification(`Error: ${(err as Error).message}`, 'error')
    }
  }

  function applyViewPrefs(): void {
    if (viewPrefs.starfield !== undefined) {
      engine.starfieldRotationEnabled = viewPrefs.starfield
      syncStarfieldLabel()
    }
    if (viewPrefs.photons !== undefined) {
      engine.setPhotonsEnabled(viewPrefs.photons)
      syncPhotonsLabel()
    }
    if (viewPrefs.labels !== undefined) {
      engine.setShowLabels(viewPrefs.labels)
      syncLabelsLabel()
    }
    if (viewPrefs.quality) {
      engine.setQualityPreset(viewPrefs.quality)
      syncQualityLabel()
    }
    if (viewPrefs.minimap !== undefined) {
      setMinimapVisible(viewPrefs.minimap)
      syncMinimapLabel()
    }
  }

  function syncStarfieldLabel(): void {
    const el = document.getElementById('menu-opt-starfield')
    if (el) el.textContent = `Girar Starfield (${engine.starfieldRotationEnabled ? 'ON' : 'OFF'})`
  }

  function syncPhotonsLabel(): void {
    const el = document.getElementById('menu-opt-photons')
    if (el) el.textContent = `Fotones Activos (${engine.photonsEnabled ? 'ON' : 'OFF'})`
  }

  function syncLabelsLabel(): void {
    const el = document.getElementById('menu-opt-labels')
    if (el) el.textContent = `Etiquetas (${engine.showLabels ? 'ON' : 'OFF'})`
  }

  function syncMinimapLabel(): void {
    const el = document.getElementById('menu-opt-minimap')
    const visible = !document.getElementById('minimap')?.classList.contains('minimap-hidden')
    if (el) el.textContent = `Minimapa (${visible ? 'ON' : 'OFF'})`
  }

  function syncQualityLabel(): void {
    const el = document.getElementById('menu-opt-quality')
    const labels: Record<QualityPreset, string> = {
      auto: 'Automático',
      high: 'Alta',
      low: 'Baja',
    }
    if (el) el.textContent = `Calidad: ${labels[engine.qualityPreset]}`
  }

  function setMinimapVisible(visible: boolean): void {
    syncMinimapHudLayout(visible)
  }

  applyViewPrefs()

  // --- View Control Functions ---
  function toggleStarfieldRotation(): void {
    engine.starfieldRotationEnabled = !engine.starfieldRotationEnabled
    viewPrefs.starfield = engine.starfieldRotationEnabled
    persistViewPrefs()
    syncStarfieldLabel()
    showNotification(
      `Rotación de Starfield: ${engine.starfieldRotationEnabled ? 'Activada' : 'Pausada'}`,
      'info',
    )
  }

  function togglePhotonsAnimation(): void {
    const isEnabled = !engine.photonsEnabled
    engine.setPhotonsEnabled(isEnabled)
    viewPrefs.photons = isEnabled
    persistViewPrefs()
    syncPhotonsLabel()
    showNotification(
      `Flujo de fotones animados: ${isEnabled ? 'Activado' : 'Desactivado'}`,
      'info',
    )
  }

  function toggleLabels(): void {
    engine.setShowLabels(!engine.showLabels)
    viewPrefs.labels = engine.showLabels
    persistViewPrefs()
    syncLabelsLabel()
    showNotification(`Etiquetas: ${engine.showLabels ? 'ON' : 'OFF'}`, 'info')
  }

  function toggleMinimap(): void {
    const isVisible = !document.getElementById('minimap')?.classList.contains('minimap-hidden')
    const next = !isVisible
    setMinimapVisible(next)
    viewPrefs.minimap = next
    persistViewPrefs()
    syncMinimapLabel()
    showNotification(`Minimapa: ${next ? 'ON' : 'OFF'}`, 'info')
  }

  function cycleQuality(): void {
    const order: QualityPreset[] = ['auto', 'high', 'low']
    const idx = order.indexOf(engine.qualityPreset)
    const next = order[(idx + 1) % order.length]
    engine.setQualityPreset(next)
    viewPrefs.quality = next
    persistViewPrefs()
    syncQualityLabel()
    showNotification(`Calidad de render: ${next}`, 'info')
  }

  let rescanRunning = false
  let vaultSwitchInProgress = false

  function showModalOverlay(): void {
    modalContainer.style.removeProperty('display')
    modalContainer.setAttribute('aria-hidden', 'false')
    modalContent.classList.add('modal-wide')
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')
  }

  function hideModalOverlay(): void {
    modalContainer.classList.remove('active')
    modalContainer.style.removeProperty('display')
    modalContainer.setAttribute('aria-hidden', 'true')
    modalContent.classList.remove('modal-wide')
  }

  const folderPicker = mountFolderPicker({
    container: modalContainer,
    titleEl: modalTitle,
    bodyEl: modalBody,
    errorEl: modalError,
    confirmBtn: modalConfirmBtn,
    cancelBtn: modalCancelBtn,
    closeBtn: modalCloseBtn,
    show: showModalOverlay,
    hide: hideModalOverlay,
  })

  async function openAnotherVault(): Promise<void> {
    if (vaultSwitchInProgress) return
    try {
      vaultSwitchInProgress = true
      showNotification('Seleccionando carpeta…', 'info')
      
      // Use the in-app folder picker (same as import folder) for consistent UX
      folderPicker.open({
        mode: 'vault',
        title: 'Seleccionar carpeta raíz de la nueva biblioteca',
        confirmLabel: 'Abrir como biblioteca',
        onConfirm: async (path: string) => {
          try {
            showNotification('Registrando biblioteca…', 'info')
            const result = await registerVaultFromPath(path)
            showNotification(`Biblioteca abierta: ${result.vault.name}`, 'success')
            await opts.onVaultSwitch?.(result)
          } catch (err) {
            const msg = (err as Error).message || 'Error al registrar biblioteca'
            showNotification(msg, 'error')
          } finally {
            vaultSwitchInProgress = false
          }
        },
        onCancel: () => {
          vaultSwitchInProgress = false
          showNotification('Operación cancelada', 'info')
        },
      })
    } catch (err) {
      const msg = (err as Error).message || 'Error al abrir selector'
      showNotification(msg, 'error')
      vaultSwitchInProgress = false
    }
  }

  async function openSwitchVaultModal(): Promise<void> {
    if (vaultSwitchInProgress) return
    try {
      const list = await bridge.fetchVaults()
      modalTitle.textContent = 'Cambiar biblioteca'
      modalError.textContent = ''
      modalBody.innerHTML = ''
      modalConfirmBtn.style.display = 'none'
      modalCancelBtn.style.display = 'inline-block'
      modalContent.classList.remove('modal-wide')

      if (list.vaults.length === 0) {
        modalBody.innerHTML = '<p style="margin:0;color:rgba(255,255,255,0.75)">No hay bibliotecas registradas. Usa «Abrir otra biblioteca…» primero.</p>'
      } else {
        const wrap = document.createElement('div')
        wrap.style.display = 'flex'
        wrap.style.flexDirection = 'column'
        wrap.style.gap = '8px'
        for (const v of list.vaults) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'menu-option'
          btn.style.textAlign = 'left'
          btn.disabled = !!v.active || vaultSwitchInProgress
          const label = v.active ? `${v.name} (activa)` : v.name
          const meta = v.node_count != null ? `${v.node_count} nodos` : v.path
          btn.innerHTML = `<strong>${label}</strong><br><span style="opacity:0.7;font-size:11px">${meta}</span>`
          btn.addEventListener('click', async () => {
            if (vaultSwitchInProgress) return
            vaultSwitchInProgress = true
            closeModal()
            showNotification(`Cargando ${v.name}…`, 'info')
            try {
              const result = await bridge.switchVault(v.id)
              showNotification(`Biblioteca activa: ${result.vault.name}`, 'success')
              await opts.onVaultSwitch?.(result)
            } catch (switchErr) {
              showNotification(`Error: ${(switchErr as Error).message}`, 'error')
            } finally {
              vaultSwitchInProgress = false
            }
          })
          wrap.appendChild(btn)
        }
        modalBody.appendChild(wrap)
      }
      showModalOverlay()
    } catch (err) {
      showNotification(`Error: ${(err as Error).message}`, 'error')
    }
  }

  async function runRescan(): Promise<void> {
    if (rescanRunning) return
    rescanRunning = true
    showNotification('Re-escaneando biblioteca…', 'info')
    try {
      const result = await bridge.triggerRescan()
      showNotification(
        `Escaneo completo: ${result.nodes} nodos, ${result.edges} aristas`,
        'success',
      )
      opts.onRescanComplete?.()
    } catch (err) {
      showNotification(`Error al re-escanear: ${(err as Error).message}`, 'error')
    } finally {
      rescanRunning = false
    }
  }

  const { showModal, closeModal } = createModalShell({
    container: modalContainer,
    title: modalTitle,
    body: modalBody,
    closeBtn: modalCloseBtn,
    cancelBtn: modalCancelBtn,
    confirmBtn: modalConfirmBtn,
    error: modalError,
  })

  // --- Specific Modal Handlers ---

  async function openCreateFileModal(): Promise<void> {
    folderPicker.open({
      mode: 'file',
      title: 'Importar archivo al vault',
      confirmLabel: 'Importar archivo',
      onConfirm: async (path) => {
        showNotification('Importando archivo…', 'info')
        const res = await bridge.importFileFromPath(path)
        showNotification(`Archivo importado: ${res.path}`, 'success')
        engine.enqueuePendingFocus(res.path)
      },
    })
  }

  async function openCreateFolderModal(): Promise<void> {
    folderPicker.open({
      mode: 'folder',
      title: 'Importar carpeta al vault',
      confirmLabel: 'Importar carpeta',
      onConfirm: async (path) => {
        showNotification('Importando carpeta…', 'info')
        const res = await bridge.importFolderFromPath(path)
        showNotification(`Carpeta importada: ${res.path}`, 'success')
        engine.enqueuePendingFocus(res.path)
        if (res.node_id) engine.enqueuePendingFocus(res.node_id)
      },
    })
  }


  function openImportGithubModal(): void {
    showModal(
      'Importar Repositorio GitHub',
      [
        {
          label: 'Repositorio Público (ej: owner/repo o URL)',
          id: 'url',
          type: 'text',
          placeholder: 'https://github.com/usuario/repositorio...'
        }
      ],
      async (values) => {
        const url = values.url.trim()
        if (!url) throw new Error('El repositorio es obligatorio')
        showNotification('Iniciando descarga de GitHub...', 'info')
        if ((window as any).addActivityLog) {
          (window as any).addActivityLog(`Descargando repositorio GitHub: ${url}...`, 'info')
        }
        const res = await bridge.importGithub(url)
        engine.ensureImportsWorkspaceVisible()
        const vaultHint = res.workspace_root
          ? `${res.workspace_root}/${res.path}`
          : res.path
        const repoStem = res.path.split('/').pop() || res.path
        showNotification(
          `Repositorio importado: ${res.path} — Ctrl+K «${repoStem}» (workspace imports)`,
          'success',
        )
        if ((window as any).addActivityLog) {
          ;(window as any).addActivityLog(
            `GitHub importado en: ${vaultHint}${res.node_id ? ` (nodo ${res.node_id})` : ''}. Esperando actualización del grafo…`,
            'success',
          )
        }
        engine.enqueuePendingFocus(res.path)
        if (res.node_id) engine.enqueuePendingFocus(res.node_id)
      }
    )
  }

  function openImportArxivModal(): void {
    modalTitle.textContent = 'Importar de arXiv'
    modalError.textContent = ''
    modalCancelBtn.style.display = 'inline-block'
    modalConfirmBtn.style.display = 'none'

    let activeTab: 'search' | 'id' = 'search'
    let searchLoading = false
    let importLoading = false
    let searchResults: bridge.ArxivSearchHit[] = []
    let selectedHit: bridge.ArxivSearchHit | null = null

    const panelStyle =
      'color:rgba(255,255,255,0.85);font-family:\'Helvetica Neue\',Arial,sans-serif;font-size:12px;display:flex;flex-direction:column;gap:12px;'

    modalBody.innerHTML = `
      <div id="arxiv-modal-root" style="${panelStyle}">
        <div style="display:flex;gap:8px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
          <button type="button" id="arxiv-tab-search" class="arxiv-tab active" style="flex:1;padding:6px 10px;border:1px solid rgba(79,195,247,0.4);background:rgba(79,195,247,0.15);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;">Buscar</button>
          <button type="button" id="arxiv-tab-id" class="arxiv-tab" style="flex:1;padding:6px 10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;font-size:12px;">Por ID o URL</button>
        </div>
        <div id="arxiv-panel-search">
          <label style="display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.7);">
            Consulta
            <input id="arxiv-search-q" type="text" placeholder="tema, palabras clave…" style="padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:#fff;" />
          </label>
          <div style="display:flex;gap:8px;">
            <label style="flex:1;display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.5);font-size:11px;">
              Autor (opcional)
              <input id="arxiv-search-author" type="text" placeholder="nombre autor" style="padding:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:11px;" />
            </label>
            <label style="flex:1;display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.5);font-size:11px;">
              Categoría (opcional)
              <input id="arxiv-search-cat" type="text" placeholder="cs.CL" style="padding:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:11px;" />
            </label>
          </div>
          <button type="button" id="arxiv-search-btn" style="padding:8px 14px;background:rgba(79,195,247,0.25);border:1px solid rgba(79,195,247,0.5);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;align-self:flex-start;">Buscar</button>
          <div id="arxiv-search-status" style="font-size:11px;color:rgba(255,255,255,0.45);min-height:14px;"></div>
          <div id="arxiv-results" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;border:1px solid rgba(255,255,255,0.06);border-radius:4px;padding:6px;min-height:48px;"></div>
          <button type="button" id="arxiv-import-selected" disabled style="padding:8px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.35);border-radius:4px;cursor:not-allowed;font-size:12px;align-self:flex-start;">Importar seleccionado</button>
        </div>
        <div id="arxiv-panel-id" style="display:none;">
          <label style="display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.7);">
            ID de arXiv o URL (ej: 2303.08774)
            <input id="arxiv-id-input" type="text" placeholder="Identificador del paper en arXiv…" style="padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:#fff;" />
          </label>
          <button type="button" id="arxiv-import-id-btn" style="padding:8px 14px;background:rgba(79,195,247,0.25);border:1px solid rgba(79,195,247,0.5);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;align-self:flex-start;margin-top:4px;">Importar</button>
        </div>
      </div>
    `

    const tabSearch = document.getElementById('arxiv-tab-search') as HTMLButtonElement
    const tabId = document.getElementById('arxiv-tab-id') as HTMLButtonElement
    const panelSearch = document.getElementById('arxiv-panel-search') as HTMLElement
    const panelId = document.getElementById('arxiv-panel-id') as HTMLElement
    const searchQ = document.getElementById('arxiv-search-q') as HTMLInputElement
    const searchAuthor = document.getElementById('arxiv-search-author') as HTMLInputElement
    const searchCat = document.getElementById('arxiv-search-cat') as HTMLInputElement
    const searchBtn = document.getElementById('arxiv-search-btn') as HTMLButtonElement
    const searchStatus = document.getElementById('arxiv-search-status') as HTMLElement
    const resultsEl = document.getElementById('arxiv-results') as HTMLElement
    const importSelectedBtn = document.getElementById('arxiv-import-selected') as HTMLButtonElement
    const idInput = document.getElementById('arxiv-id-input') as HTMLInputElement
    const importIdBtn = document.getElementById('arxiv-import-id-btn') as HTMLButtonElement

    const tabActiveStyle =
      'flex:1;padding:6px 10px;border:1px solid rgba(79,195,247,0.4);background:rgba(79,195,247,0.15);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;'
    const tabInactiveStyle =
      'flex:1;padding:6px 10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;font-size:12px;'

    function setTab(tab: 'search' | 'id'): void {
      activeTab = tab
      tabSearch.style.cssText = tab === 'search' ? tabActiveStyle : tabInactiveStyle
      tabId.style.cssText = tab === 'id' ? tabActiveStyle : tabInactiveStyle
      panelSearch.style.display = tab === 'search' ? 'flex' : 'none'
      panelId.style.display = tab === 'id' ? 'block' : 'none'
      panelSearch.style.flexDirection = 'column'
      panelSearch.style.gap = '12px'
    }

    function updateImportSelectedBtn(): void {
      const enabled = !!selectedHit && !importLoading
      importSelectedBtn.disabled = !enabled
      importSelectedBtn.style.cursor = enabled ? 'pointer' : 'not-allowed'
      importSelectedBtn.style.color = enabled ? '#4fc3f7' : 'rgba(255,255,255,0.35)'
      importSelectedBtn.style.background = enabled
        ? 'rgba(79,195,247,0.25)'
        : 'rgba(255,255,255,0.08)'
      importSelectedBtn.style.borderColor = enabled
        ? 'rgba(79,195,247,0.5)'
        : 'rgba(255,255,255,0.15)'
    }

    function renderResults(): void {
      resultsEl.innerHTML = ''
      if (!searchResults.length) {
        resultsEl.innerHTML =
          '<span style="color:rgba(255,255,255,0.35);font-size:11px;padding:4px;">Sin resultados. Pulsa Buscar.</span>'
        return
      }
      for (const hit of searchResults) {
        const row = document.createElement('button')
        row.type = 'button'
        const withdrawn = !!hit.withdrawn
        const selected = selectedHit?.arxiv_id === hit.arxiv_id
        row.style.cssText = [
          'text-align:left;padding:8px;border-radius:4px;cursor:pointer;',
          'border:1px solid',
          selected ? 'rgba(79,195,247,0.55)' : 'rgba(255,255,255,0.08)',
          'background:',
          selected ? 'rgba(79,195,247,0.12)' : 'rgba(0,0,0,0.2)',
          withdrawn ? 'opacity:0.55;' : '',
        ].join(' ')
        const authors = hit.authors?.slice(0, 3).join(', ') || '—'
        const snippet = (hit.abstract || '').slice(0, 120)
        row.innerHTML = `
          <div style="font-size:12px;color:${withdrawn ? 'rgba(255,180,100,0.85)' : '#e0e0e0'};font-weight:500;">${escapeHtml(hit.title)}${withdrawn ? ' <span style="font-size:10px;color:#ffb74d;">(retirado)</span>' : ''}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:2px;">${escapeHtml(authors)} · ${escapeHtml(hit.published || '')} · ${escapeHtml(hit.arxiv_id)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:4px;line-height:1.4;">${escapeHtml(snippet)}${(hit.abstract || '').length > 120 ? '…' : ''}</div>
        `
        row.onclick = () => {
          selectedHit = hit
          renderResults()
          updateImportSelectedBtn()
        }
        resultsEl.appendChild(row)
      }
    }

    function escapeHtml(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    async function runImport(arxivId: string): Promise<void> {
      const id = arxivId.trim()
      if (!id) throw new Error('El identificador de arXiv es obligatorio')
      showNotification('Consultando arXiv API...', 'info')
      if ((window as any).addActivityLog) {
        ;(window as any).addActivityLog(`Importando arXiv ID: ${id}...`, 'info')
      }
      const res = await bridge.importArxiv(id)
      const vaultHint = res.workspace_root
        ? `${res.workspace_root}/${res.path}`
        : res.path
      showNotification(
        `Importado en el vault: ${res.path} — busca en el grafo o Ctrl+K por título`,
        'success',
      )
      if ((window as any).addActivityLog) {
        ;(window as any).addActivityLog(
          `arXiv guardado: ${vaultHint}${res.node_id ? ` (nodo ${res.node_id})` : ''}. Sincronizando grafo…`,
          'success',
        )
      }
      const queue = (engine as any)._pendingFocusQueue ??= []
      queue.push(res.path)
      if (res.node_id) queue.push(res.node_id)
      closeModal()
    }

    async function doSearch(): Promise<void> {
      const q = searchQ.value.trim()
      const author = searchAuthor.value.trim()
      const cat = searchCat.value.trim()
      if (!q && !author && !cat) {
        searchStatus.textContent = 'Indica consulta, autor o categoría.'
        searchStatus.style.color = '#ffb74d'
        return
      }
      searchLoading = true
      searchBtn.disabled = true
      searchBtn.textContent = 'Buscando…'
      searchStatus.textContent = ''
      searchStatus.style.color = 'rgba(255,255,255,0.45)'
      selectedHit = null
      updateImportSelectedBtn()
      try {
        const data = await bridge.searchArxiv({
          q: q || undefined,
          author: author || undefined,
          cat: cat || undefined,
          max: 15,
        })
        searchResults = data.results
        const totalHint =
          data.total != null ? ` (${data.total} en arXiv)` : ''
        searchStatus.textContent = `${searchResults.length} resultado(s)${totalHint}`
        renderResults()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('403')) {
          searchStatus.textContent =
            'arXiv bloqueó la petición (403). Espera unos segundos e inténtalo de nuevo.'
        } else {
          searchStatus.textContent = msg
        }
        searchStatus.style.color = '#ef5350'
        searchResults = []
        renderResults()
      } finally {
        searchLoading = false
        searchBtn.disabled = false
        searchBtn.textContent = 'Buscar'
      }
    }

    tabSearch.onclick = () => setTab('search')
    tabId.onclick = () => setTab('id')
    searchBtn.onclick = () => void doSearch()
    searchQ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void doSearch()
    })

    importSelectedBtn.onclick = async () => {
      if (!selectedHit || importLoading) return
      importLoading = true
      updateImportSelectedBtn()
      importSelectedBtn.textContent = 'Importando…'
      modalError.textContent = ''
      try {
        await runImport(selectedHit.arxiv_id)
      } catch (err: unknown) {
        modalError.textContent =
          err instanceof Error ? err.message : 'Error al importar'
        importLoading = false
        importSelectedBtn.textContent = 'Importar seleccionado'
        updateImportSelectedBtn()
      }
    }

    importIdBtn.onclick = async () => {
      if (importLoading) return
      importLoading = true
      importIdBtn.disabled = true
      importIdBtn.textContent = 'Importando…'
      modalError.textContent = ''
      try {
        await runImport(idInput.value)
      } catch (err: unknown) {
        modalError.textContent =
          err instanceof Error ? err.message : 'Error al importar'
        importLoading = false
        importIdBtn.disabled = false
        importIdBtn.textContent = 'Importar'
      }
    }

    setTab('search')
    renderResults()
    updateImportSelectedBtn()

    modalContainer.style.display = 'flex'
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')

    modalCloseBtn.onclick = () => closeModal()
    modalCancelBtn.onclick = () => closeModal()
  }

  function openImportPubmedModal(): void {
    showModal(
      'Importar de PubMed',
      [
        {
          label: 'PMID de PubMed o URL (ej: 36915867)',
          id: 'pmid',
          type: 'text',
          placeholder: 'Identificador del artículo en PubMed...'
        }
      ],
      async (values) => {
        const pmid = values.pmid.trim()
        if (!pmid) throw new Error('El PMID de PubMed es obligatorio')
        showNotification('Consultando PubMed API...', 'info')
        if ((window as any).addActivityLog) {
          (window as any).addActivityLog(`Buscando PubMed PMID: ${pmid}...`, 'info')
        }
        const res = await bridge.importPubmed(pmid)
        showNotification(`Artículo importado como Markdown en: ${res.path}`, 'success')
        if ((window as any).addActivityLog) {
          (window as any).addActivityLog(`PubMed importado en: ${res.path}. Esperando actualización del grafo...`, 'success')
        }
        engine.enqueuePendingFocus(res.path)
      }
    )
  }

  function openHelpGuideModal(): void {
    mountHelpGuideStyles()
    modalTitle.textContent = 'Ayuda — navegar La Gran Biblioteca'
    modalConfirmBtn.disabled = false
    modalConfirmBtn.textContent = 'Cerrar'
    modalCancelBtn.style.display = 'none'
    modalError.textContent = ''
    modalBody.innerHTML = HELP_GUIDE_HTML

    modalContainer.style.display = 'flex'
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')

    modalCloseBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
    modalConfirmBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
  }

  function openLicencesModal(): void {
    modalTitle.textContent = 'Licencias del Proyecto'
    modalConfirmBtn.disabled = false
    modalConfirmBtn.textContent = 'Cerrar'
    modalConfirmBtn.onclick = () => closeModal()
    modalCancelBtn.style.display = 'none' // hide cancel button for licences modal
    modalError.textContent = ''

    // Render elegant credits lists inside modal body
    modalBody.innerHTML = `
      <div style="color: rgba(255,255,255,0.8); display:flex; flex-direction:column; gap:14px; font-family:'Helvetica Neue', Arial, sans-serif; font-size:12px; line-height:1.6; max-height: 350px; overflow-y: auto; padding-right:6px;">
        <p><strong>La Gran Biblioteca</strong> se construye sobre tecnologías de código abierto de última generación:</p>
        
        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">Three.js</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Motor de renderizado 3D acelerado por GPU.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>

        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">3D Force Graph</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Visualización de grafos tridimensionales con fuerzas físicas.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>

        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">Marked</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Compilador rápido de Markdown para previsualización.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>

        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">Highlight.js</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Resaltado de sintaxis sintáctico en múltiples lenguajes.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia BSD-3</span>
        </div>

        <div>
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">FastAPI & Python</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Backend de alta velocidad, indexador de SQLite y observador de archivos.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>
      </div>
    `

    modalContainer.style.display = 'flex'
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')

    // Clean display cancel button state when closing
    modalCloseBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
    modalConfirmBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
  }
}
