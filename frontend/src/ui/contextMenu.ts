import { openNode } from '../lib/bridge'

const NON_FILE_TYPES = new Set(['folder', 'workspace', 'project'])

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

  function showCtxMenu(x: number, y: number, nodeId: string, nodeType: string): void {
    if (NON_FILE_TYPES.has(nodeType)) return

    ctxMenu.style.left = `${x}px`
    ctxMenu.style.top  = `${y}px`
    ctxMenu.style.display = 'block'

    const btnFolder = document.getElementById('ctx-open-folder')!
    const btnFile   = document.getElementById('ctx-open-file')!
    const newFolder = btnFolder.cloneNode(true) as HTMLElement
    const newFile   = btnFile.cloneNode(true) as HTMLElement
    btnFolder.replaceWith(newFolder)
    btnFile.replaceWith(newFile)

    newFolder.addEventListener('click', async () => {
      hideCtxMenu()
      try { await openNode(nodeId, true) }
      catch { showToast('No se pudo abrir carpeta.', true) }
    })
    newFile.addEventListener('click', async () => {
      hideCtxMenu()
      try { await openNode(nodeId, false) }
      catch { showToast('No se pudo abrir archivo.', true) }
    })
  }

  engine.onNodeRightClick((node, event) => {
    event.preventDefault()
    showCtxMenu(event.clientX, event.clientY, node.id as string, node.type as string)
  })

  document.addEventListener('click', (e) => {
    if (!ctxMenu.contains(e.target as globalThis.Node)) hideCtxMenu()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCtxMenu()
  })
}
