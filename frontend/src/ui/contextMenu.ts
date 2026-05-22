import { openNode } from '../lib/bridge'

const NON_OPENABLE_TYPES = new Set(['tag', 'workspace', 'project'])

interface Engine {
  onNodeRightClick(cb: (node: Record<string, unknown>, event: MouseEvent) => void): void
}

export function setupContextMenu(
  engine: Engine,
  showToast: (msg: string, isError?: boolean) => void,
): void {
  const ctxMenu = document.getElementById('ctx-menu')!

  function hideCtxMenu(): void {
    ctxMenu.style.display = 'none'
  }

  function showCtxMenu(
    x: number,
    y: number,
    node: Record<string, unknown>,
  ): void {
    const nodeType = node.type as string
    const nodeId = node.id as string
    const nodePath = node.path as string | undefined

    if (NON_OPENABLE_TYPES.has(nodeType) || !nodePath) return

    ctxMenu.style.left = `${x}px`
    ctxMenu.style.top = `${y}px`
    ctxMenu.style.display = 'block'

    const btnReveal = document.getElementById('ctx-open-folder')!
    const btnOpen = document.getElementById('ctx-open-file')!
    const newReveal = btnReveal.cloneNode(true) as HTMLButtonElement
    const newOpen = btnOpen.cloneNode(true) as HTMLButtonElement
    btnReveal.replaceWith(newReveal)
    btnOpen.replaceWith(newOpen)

    const isFolder = nodeType === 'folder'

    if (isFolder) {
      newReveal.textContent = 'Abrir carpeta'
      newReveal.style.display = 'block'
      newOpen.style.display = 'none'
      newReveal.addEventListener('click', async () => {
        hideCtxMenu()
        try {
          await openNode(nodeId, false)
        } catch {
          showToast('No se pudo abrir la carpeta.', true)
        }
      })
    } else {
      newReveal.textContent = 'Revelar en Explorador'
      newOpen.textContent = 'Abrir archivo'
      newReveal.style.display = 'block'
      newOpen.style.display = 'block'
      newReveal.addEventListener('click', async () => {
        hideCtxMenu()
        try {
          await openNode(nodeId, true)
        } catch {
          showToast('No se pudo revelar en Explorador.', true)
        }
      })
      newOpen.addEventListener('click', async () => {
        hideCtxMenu()
        try {
          await openNode(nodeId, false)
        } catch {
          showToast('No se pudo abrir el archivo.', true)
        }
      })
    }
  }

  engine.onNodeRightClick((node, event) => {
    event.preventDefault()
    showCtxMenu(event.clientX, event.clientY, node)
  })

  document.addEventListener('click', (e) => {
    if (!ctxMenu.contains(e.target as globalThis.Node)) hideCtxMenu()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCtxMenu()
  })
}
