const STORAGE_KEY = 'lgb.legendDock'

interface LegendDockState {
  x?: number
  y?: number
  collapsed?: boolean
}

function loadState(): LegendDockState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as LegendDockState
  } catch {
    return {}
  }
}

function saveState(state: LegendDockState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function clampToViewport(left: number, top: number, width: number, height: number): { left: number; top: number } {
  const maxLeft = Math.max(0, window.innerWidth - width)
  const maxTop = Math.max(0, window.innerHeight - height)
  return {
    left: Math.max(0, Math.min(left, maxLeft)),
    top: Math.max(0, Math.min(top, maxTop)),
  }
}

export function initLegendDock(): void {
  const dock = document.getElementById('legend-dock')
  const header = dock?.querySelector('.legend-dock-header') as HTMLElement | null
  const dragHandle = dock?.querySelector('.legend-dock-drag') as HTMLElement | null
  const toggleBtn = dock?.querySelector('.legend-dock-toggle') as HTMLButtonElement | null

  if (!dock || !header || !toggleBtn) return

  const dockEl = dock
  const headerEl = header
  const toggleEl = toggleBtn
  const state = loadState()

  function applyPosition(x?: number, y?: number): void {
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) {
      const rect = dockEl.getBoundingClientRect()
      const { left, top } = clampToViewport(x, y, rect.width, rect.height)
      dockEl.style.left = `${left}px`
      dockEl.style.top = `${top}px`
      dockEl.style.right = 'auto'
      dockEl.style.bottom = 'auto'
    } else {
      dockEl.style.left = ''
      dockEl.style.top = ''
      dockEl.style.right = ''
      dockEl.style.bottom = ''
    }
  }

  function setCollapsed(collapsed: boolean): void {
    dockEl.classList.toggle('collapsed', collapsed)
    toggleEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggleEl.textContent = collapsed ? '+' : '−'
    state.collapsed = collapsed
    saveState(state)
  }

  applyPosition(state.x, state.y)
  if (state.collapsed) setCollapsed(true)

  toggleEl.addEventListener('click', (e) => {
    e.stopPropagation()
    setCollapsed(!dockEl.classList.contains('collapsed'))
  })

  let dragging = false
  let dragOffsetX = 0
  let dragOffsetY = 0

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return
    const rect = dockEl.getBoundingClientRect()
    const { left, top } = clampToViewport(
      e.clientX - dragOffsetX,
      e.clientY - dragOffsetY,
      rect.width,
      rect.height,
    )
    dockEl.style.left = `${left}px`
    dockEl.style.top = `${top}px`
    dockEl.style.right = 'auto'
    dockEl.style.bottom = 'auto'
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return
    dragging = false
    headerEl.style.touchAction = ''
    headerEl.releasePointerCapture(e.pointerId)
    headerEl.removeEventListener('pointermove', onPointerMove)
    headerEl.removeEventListener('pointerup', onPointerUp)
    headerEl.removeEventListener('pointercancel', onPointerUp)

    const rect = dockEl.getBoundingClientRect()
    state.x = rect.left
    state.y = rect.top
    saveState(state)
  }

  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.legend-dock-toggle')) return

    dragging = true
    const rect = dockEl.getBoundingClientRect()
    dragOffsetX = e.clientX - rect.left
    dragOffsetY = e.clientY - rect.top

    dockEl.style.left = `${rect.left}px`
    dockEl.style.top = `${rect.top}px`
    dockEl.style.right = 'auto'
    dockEl.style.bottom = 'auto'

    headerEl.style.touchAction = 'none'
    headerEl.setPointerCapture(e.pointerId)
    headerEl.addEventListener('pointermove', onPointerMove)
    headerEl.addEventListener('pointerup', onPointerUp)
    headerEl.addEventListener('pointercancel', onPointerUp)
    e.preventDefault()
  }

  headerEl.addEventListener('pointerdown', startDrag)
  dragHandle?.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    startDrag(e)
  })
}

/** Keep activity-log offset in sync when minimap visibility changes. */
export function syncMinimapHudLayout(visible: boolean): void {
  document.body.classList.toggle('minimap-hidden', !visible)
  document.getElementById('minimap')?.classList.toggle('minimap-hidden', !visible)
}
