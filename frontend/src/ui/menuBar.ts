import { Graph3DEngine } from '../render3d/Graph3DEngine'
import * as bridge from '../lib/bridge'
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
import { syncMinimapHudLayout } from './legendDock'

import { setupImportModals, type ModalContext } from './modals/importModals'
import { setupVaultModals } from './modals/vaultModals'
import { setupHelpModals } from './modals/helpModals'

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

  // --- Modal shell (showModal / closeModal) ---
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

  const { showModal, closeModal } = createModalShell({
    container: modalContainer,
    title: modalTitle,
    body: modalBody,
    closeBtn: modalCloseBtn,
    cancelBtn: modalCancelBtn,
    confirmBtn: modalConfirmBtn,
    error: modalError,
  })

  // --- Build shared ModalContext for modal submodules ---
  const modalCtx: ModalContext = {
    showModal,
    closeModal,
    showNotification,
    modalTitle,
    modalBody,
    modalError,
    modalContainer,
    modalConfirmBtn,
    modalCancelBtn,
    modalCloseBtn,
    engine,
    bridge,
  }

  const importModals = setupImportModals(modalCtx)
  const vaultModals = setupVaultModals(modalCtx, folderPicker, {
    onRescanComplete: opts.onRescanComplete,
    onVaultSwitch: opts.onVaultSwitch,
  })
  const helpModals = setupHelpModals(modalCtx)

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
        importModals.openImportGithubModal()
        break
      case 'import-arxiv':
        importModals.openImportArxivModal()
        break
      case 'import-pubmed':
        importModals.openImportPubmedModal()
        break
      case 'rescan-library':
        void vaultModals.runRescan()
        break
      case 'open-vault':
        void vaultModals.openAnotherVault()
        break
      case 'switch-vault':
        void vaultModals.openSwitchVaultModal()
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
        helpModals.openHelpGuideModal()
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
        getPanelDock().toggle('filters')
        break
      case 'toggle-constellation-layout':
        toggleConstellationLayout()
        break
      case 'open-constellation-settings':
        opts.constellationSettings?.openPanel()
        break
      case 'constellation-relayout':
        void runConstellationRelayout()
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
        helpModals.openLicencesModal()
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

  // --- File/Folder import modals (use folderPicker, stay in menuBar) ---

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
}