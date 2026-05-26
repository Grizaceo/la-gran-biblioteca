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

function truncateLabel(text: string, max = 20): string {
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
  }

  function makeBtn(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = text
    btn.addEventListener('click', onClick)
    return btn
  }

  function makeSep(): HTMLDivElement {
    const sep = document.createElement('div')
    sep.className = 'ctx-sep'
    return sep
  }

  function makeHeading(text: string): HTMLDivElement {
    const h = document.createElement('div')
    h.className = 'ctx-heading'
    h.textContent = text
    return h
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
    ctxMenu.style.left = `${x}px`
    ctxMenu.style.top = `${y}px`
    ctxMenu.style.display = 'block'

    ctxMenu.appendChild(makeHeading('Acceso rápido'))
    const slots = loadSlots()
    for (let i = 0; i < SLOT_COUNT; i++) {
      const occupied = slots[i]
      let label = `Asignar a ${i + 1}`
      if (occupied) {
        label = `Asignar a ${i + 1} (reemplaza «${truncateLabel(occupied.label)}»)`
      }
      ctxMenu.appendChild(makeBtn(label, () => {
        hideCtxMenu()
        assignSlot(i, {
          id: nodeId,
          name: node.name as string | undefined,
          label: node.label as string | undefined,
          type: nodeType,
        })
        onQuickAccessChange()
        showToast(`Asignado a acceso ${i + 1}`)
      }))
    }

    if (isNodeInSlots(nodeId)) {
      ctxMenu.appendChild(makeSep())
      ctxMenu.appendChild(makeBtn('Quitar de accesos', () => {
        hideCtxMenu()
        clearAllSlotsForNode(nodeId)
        onQuickAccessChange()
        showToast('Eliminado de accesos rápidos')
      }))
    }

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
