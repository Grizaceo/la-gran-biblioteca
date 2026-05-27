/**
 * Coordinates left config panels: stack without overlap, smooth open/close, Escape / click-outside.
 */

export type ConfigPanelId = 'coverage' | 'visibility' | 'view-options'

const PANEL_IDS: ConfigPanelId[] = ['coverage', 'visibility', 'view-options']

export interface PanelDockOptions {
  dockRoot?: HTMLElement
  onLayout?: (openCount: number, dockWidth: number) => void
}

export interface RegisterPanelOptions {
  id: ConfigPanelId
  element: HTMLElement
  /** CSS selectors for toggle buttons */
  triggers?: string[]
  onOpen?: () => void
  onClose?: () => void
}

export interface PanelDockAPI {
  register: (opts: RegisterPanelOptions) => void
  isOpen: (id: ConfigPanelId) => boolean
  open: (id: ConfigPanelId) => void
  close: (id: ConfigPanelId) => void
  toggle: (id: ConfigPanelId) => void
  closeAll: () => void
  openPanel: (id: ConfigPanelId) => void
}

let instance: PanelDockAPI | null = null

export function getPanelDock(): PanelDockAPI {
  if (!instance) throw new Error('[panelDock] initPanelDock() must run first')
  return instance
}

export function initPanelDock(opts: PanelDockOptions = {}): PanelDockAPI {
  const dockRoot = opts.dockRoot ?? document.getElementById('config-dock')
  const registry = new Map<ConfigPanelId, RegisterPanelOptions>()

  function setDockWidth(): void {
    const openPanels = PANEL_IDS.filter((id) => {
      const el = registry.get(id)?.element
      return el?.classList.contains('is-open')
    })
    const width = openPanels.length > 0 ? 272 : 0
    document.documentElement.style.setProperty('--config-dock-width', `${width}px`)
    document.body.classList.toggle('config-dock-open', openPanels.length > 0)
    opts.onLayout?.(openPanels.length, width)
  }

  function isOpen(id: ConfigPanelId): boolean {
    return registry.get(id)?.element.classList.contains('is-open') ?? false
  }

  function open(id: ConfigPanelId): void {
    const entry = registry.get(id)
    if (!entry) return
    entry.element.classList.add('is-open')
    entry.element.setAttribute('aria-hidden', 'false')
    entry.onOpen?.()
    syncTriggers(id, true)
    setDockWidth()
  }

  function close(id: ConfigPanelId): void {
    const entry = registry.get(id)
    if (!entry) return
    entry.element.classList.remove('is-open')
    entry.element.setAttribute('aria-hidden', 'true')
    entry.onClose?.()
    syncTriggers(id, false)
    setDockWidth()
  }

  function toggle(id: ConfigPanelId): void {
    if (isOpen(id)) close(id)
    else open(id)
  }

  function closeAll(): void {
    for (const id of PANEL_IDS) close(id)
  }

  function syncTriggers(id: ConfigPanelId, open: boolean): void {
    const entry = registry.get(id)
    if (!entry?.triggers) return
    for (const sel of entry.triggers) {
      document.querySelectorAll(sel).forEach((el) => {
        el.classList.toggle('dock-trigger-active', open)
        if (el instanceof HTMLButtonElement) {
          el.setAttribute('aria-expanded', open ? 'true' : 'false')
        }
      })
    }
  }

  function register(reg: RegisterPanelOptions): void {
    registry.set(reg.id, reg)
    reg.element.classList.add('dock-panel')
    reg.element.dataset.panel = reg.id
    if (!reg.element.classList.contains('is-open')) {
      reg.element.setAttribute('aria-hidden', 'true')
    }
    for (const sel of reg.triggers ?? []) {
      document.querySelectorAll(sel).forEach((el) => {
        if ((el as HTMLElement).dataset.panelTrigger) return
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          toggle(reg.id)
        })
      })
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    const open = PANEL_IDS.filter((id) => isOpen(id))
    if (!open.length) return
    close(open[open.length - 1])
    e.preventDefault()
  })

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('#config-dock')) return
    if (target.closest('.dock-trigger') || target.closest('[data-panel-trigger]')) return
    if (target.closest('#menu-bar') || target.closest('.menu-dropdown')) return
    if (target.closest('#search-container') || target.closest('#search-results')) return
    if (target.closest('#node-detail')) return
    if (target.closest('#ctx-menu')) return
    const open = PANEL_IDS.filter((id) => isOpen(id))
    if (!open.length) return
    close(open[open.length - 1])
  })

  document.querySelectorAll('[data-panel-trigger]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = (el as HTMLElement).dataset.panelTrigger as ConfigPanelId | undefined
      if (id && PANEL_IDS.includes(id)) toggle(id)
    })
  })

  dockRoot?.addEventListener('click', (e) => {
    const closeBtn = (e.target as HTMLElement).closest('[data-panel-close]')
    if (!closeBtn) return
    e.stopPropagation()
    const id = (closeBtn.closest('.dock-panel') as HTMLElement | null)?.dataset.panel as ConfigPanelId | undefined
    if (id && PANEL_IDS.includes(id)) close(id)
  })

  instance = {
    register,
    isOpen,
    open,
    close,
    toggle,
    closeAll,
    openPanel: open,
  }

  setDockWidth()
  return instance
}
