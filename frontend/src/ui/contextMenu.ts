import { openNode } from '../lib/bridge'
import {
  SLOT_COUNT,
  loadSlots,
  assignSlot,
  clearAllSlotsForNode,
  isNodeInSlots,
} from './quickAccess'

const NON_OPENABLE_TYPES = new Set(['tag', 'workspace', 'project'])

interface Engine {
  onNodeRightClick(cb: (node: Record<string, unknown>, event: MouseEvent) => void): void
}

function truncateLabel(text: string, max = 18): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function setupContextMenu(
  engine: Engine,
  showToast: (msg: string, isError?: boolean) => void,
  onQuickAccessChange: () => void,
): void {
  const ctxMenu = document.getElementById('ctx-menu')!

  function hideCtxMenu(): void {
    ctxMenu.style.display = 'none'
    ctxMenu.innerHTML = ''
    ctxMenu.classList.remove('ctx-menu-flip')
  }

  function makeBtn(text: string, onClick: () => void, className = ''): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `ctx-item${className ? ` ${className}` : ''}`
    btn.textContent = text
    btn.addEventListener('click', onClick)
    return btn
  }

  function makeSep(): HTMLDivElement {
    const sep = document.createElement('div')
    sep.className = 'ctx-sep'
    return sep
  }

  function buildQuickAccessSubmenu(
    node: Record<string, unknown>,
    nodeId: string,
    nodeType: string,
  ): HTMLDivElement {
    const wrap = document.createElement('div')
    wrap.className = 'ctx-submenu-wrap'

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'ctx-item ctx-item-has-submenu'
    trigger.innerHTML = 'Acceso rápido<span class="ctx-chevron" aria-hidden="true">›</span>'

    const submenu = document.createElement('div')
    submenu.className = 'ctx-submenu'
    submenu.setAttribute('role', 'menu')
    submenu.setAttribute('aria-label', 'Asignar acceso rápido')

    const slots = loadSlots()
    for (let i = 0; i < SLOT_COUNT; i++) {
      const occupied = slots[i]
      let label = `Hueco ${i + 1}`
      if (occupied) {
        label = `${i + 1} · ${truncateLabel(occupied.label)}`
      }
      submenu.appendChild(makeBtn(label, () => {
        hideCtxMenu()
        assignSlot(i, {
          id: nodeId,
          name: node.name as string | undefined,
          label: node.label as string | undefined,
          type: nodeType,
        })
        onQuickAccessChange()
        showToast(`Asignado a acceso ${i + 1}`)
      }, occupied ? 'ctx-slot-occupied' : 'ctx-slot-empty'))
    }

    if (isNodeInSlots(nodeId)) {
      submenu.appendChild(makeSep())
      submenu.appendChild(makeBtn('Quitar de accesos', () => {
        hideCtxMenu()
        clearAllSlotsForNode(nodeId)
        onQuickAccessChange()
        showToast('Eliminado de accesos rápidos')
      }, 'ctx-item-danger'))
    }

    wrap.appendChild(trigger)
    wrap.appendChild(submenu)
    return wrap
  }

  function showCtxMenu(
    x: number,
    y: number,
    node: Record<string, unknown>,
  ): void {
    const nodeType = node.type as string
    const nodeId = node.id as string
    const nodePath = node.path as string | undefined

    ctxMenu.innerHTML = ''
    ctxMenu.classList.remove('ctx-menu-flip')

    ctxMenu.appendChild(buildQuickAccessSubmenu(node, nodeId, nodeType))

    const canOpen = !NON_OPENABLE_TYPES.has(nodeType) && !!nodePath
    if (canOpen) {
      ctxMenu.appendChild(makeSep())
      const isFolder = nodeType === 'folder'
      if (isFolder) {
        ctxMenu.appendChild(makeBtn('Abrir carpeta', () => {
          hideCtxMenu()
          void openNode(nodeId, false).catch(() => {
            showToast('No se pudo abrir la carpeta.', true)
          })
        }))
      } else {
        ctxMenu.appendChild(makeBtn('Revelar en Explorador', () => {
          hideCtxMenu()
          void openNode(nodeId, true).catch(() => {
            showToast('No se pudo revelar en Explorador.', true)
          })
        }))
        ctxMenu.appendChild(makeBtn('Abrir archivo', () => {
          hideCtxMenu()
          void openNode(nodeId, false).catch(() => {
            showToast('No se pudo abrir el archivo.', true)
          })
        }))
      }
    }

    ctxMenu.style.display = 'block'
    ctxMenu.style.left = `${x}px`
    ctxMenu.style.top = `${y}px`

    requestAnimationFrame(() => {
      const rect = ctxMenu.getBoundingClientRect()
      let left = x
      let top = y
      if (rect.right > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - rect.width - 8)
      }
      if (rect.bottom > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - rect.height - 8)
      }
      ctxMenu.style.left = `${left}px`
      ctxMenu.style.top = `${top}px`

      const updated = ctxMenu.getBoundingClientRect()
      if (updated.right > window.innerWidth - 160) {
        ctxMenu.classList.add('ctx-menu-flip')
      }
    })
  }

  engine.onNodeRightClick((node, event) => {
    event.preventDefault()
    showCtxMenu(event.clientX, event.clientY, node)
  })

  document.addEventListener('click', (e) => {
    if (ctxMenu.style.display === 'block' && !ctxMenu.contains(e.target as globalThis.Node)) {
      hideCtxMenu()
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCtxMenu()
  })
}
