import { fetchGraph, subscribeToUpdates } from './lib/bridge'
import type { Graph } from './lib/bridge'
import { Graph3DEngine } from './render3d/Graph3DEngine'
import { initSearch } from './render3d/ui/search.js'
import { initMinimap } from './render3d/ui/minimap.js'
import { initFocus } from './render3d/ui/focus.js'
import { initVisibility } from './render3d/ui/visibility.js'
import { setupDetailPanel } from './ui/detailPanel'
import { setupTooltip } from './ui/tooltip'
import { setupContextMenu } from './ui/contextMenu'
import { initMenuBar } from './ui/menuBar'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const container   = document.getElementById('graph-container')!
  const loadingText = document.getElementById('loading-text')!
  const loadingErr  = document.getElementById('loading-error')!
  const statsEl     = document.getElementById('stats')!
  const statusEl    = document.getElementById('status')!
  const loadingEl   = document.getElementById('loading')!

  let currentGraph: Graph | null = null

  function showError(msg: string): void {
    loadingText.style.display = 'none'
    ;(loadingEl.querySelector('.spinner') as HTMLElement).style.display = 'none'
    loadingErr.style.display = 'block'
    loadingErr.textContent   = msg
  }

  function showToast(msg: string, isError = false): void {
    const toast = document.getElementById('info-msg')!
    toast.textContent = msg
    toast.style.color = isError ? '#ef5350' : '#4fc3f7'
    setTimeout(() => { toast.textContent = ''; toast.style.color = '' }, 4000)
  }

  document.title = 'LGB – iniciando…'
  const step = (msg: string) => { loadingText.textContent = msg; document.title = 'LGB – ' + msg }

  step('1/6 Conectando al backend…')
  let graph: Graph
  try {
    graph = await fetchGraph()
  } catch (err) {
    showError(`No se pudo conectar al backend: ${(err as Error).message}`)
    return
  }
  currentGraph = graph

  step('2/6 Iniciando motor 3D…')
  let engine: Graph3DEngine
  try {
    engine = new Graph3DEngine(container)
  } catch (err) {
    showError(`Error motor 3D: ${(err as Error).stack ?? (err as Error).message}`)
    return
  }

  // ── UI wiring ────────────────────────────────────────────────────────────

  step('3/6 Conectando UI…')
  let panel!: ReturnType<typeof setupDetailPanel>
  try {
    const focus = initFocus(engine.fg)
    initVisibility(engine)

    panel = setupDetailPanel(container, engine, () => currentGraph, showToast)

    setupTooltip(engine, container, (node) => focus.setHoveredNode(node))

    setupContextMenu(engine, showToast)

    initMenuBar(engine)

    // Activity Log Collapsible & Global Logger initialization
    const logPanel = document.getElementById('activity-log')
    const logHeader = document.getElementById('activity-log-header')
    if (logPanel && logHeader) {
      logHeader.addEventListener('click', () => {
        logPanel.classList.toggle('expanded')
      })
    }

    (window as any).addActivityLog = (msg: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') => {
      const content = document.getElementById('activity-log-content')
      if (!content) return
      const entry = document.createElement('div')
      entry.className = `log-entry log-${type}`
      
      const timeSpan = document.createElement('span')
      timeSpan.className = 'log-time'
      const now = new Date()
      timeSpan.textContent = now.toTimeString().split(' ')[0]
      
      const textSpan = document.createElement('span')
      textSpan.className = 'log-text'
      textSpan.textContent = msg
      
      entry.appendChild(timeSpan)
      entry.appendChild(textSpan)
      content.appendChild(entry)
      content.scrollTop = content.scrollHeight
    }

    engine.onNodeClick(async (node) => {
      await panel.selectNode(node.id as string)
    })

    document.getElementById('btn-reset')!.addEventListener('click', () => {
      engine.fg.cameraPosition({ x: 0, y: 0, z: 400 })
    })

    window.addEventListener('resize', () => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
    })
  } catch (err) {
    showError(`Error UI: ${(err as Error).stack ?? (err as Error).message}`)
    return
  }

  step('4/6 Cargando grafo…')
  try {
    engine.setGraph(graph)
  } catch (err) {
    showError(`Error cargando grafo: ${(err as Error).stack ?? (err as Error).message}`)
    return
  }

  statsEl.textContent  = `${graph.nodes.length} nodos · ${graph.edges.length} aristas`
  statusEl.textContent = 'Conectado'

  if ((window as any).addActivityLog) {
    (window as any).addActivityLog('¡Conexión establecida con el backend de La Gran Biblioteca!', 'success');
    (window as any).addActivityLog(`Grafo inicial cargado: ${graph.nodes.length} nodos y ${graph.edges.length} enlaces.`, 'info');
  }

  step('5/6 Iniciando minimap y búsqueda…')
  try {
    const minimap = initMinimap(engine.fg)
    const search  = initSearch(engine.fg)

    engine.onMinimapTick = () => minimap.update()
    engine.onStop = () => minimap.invalidateBounds()

    search.setup(graph.nodes)
    minimap.update()

    const unsubscribe = subscribeToUpdates((updated: Graph) => {
      currentGraph = updated
      engine.applyUpdate(updated)
      statsEl.textContent = `${updated.nodes.length} nodos · ${updated.edges.length} aristas`
      minimap.invalidateBounds()
      minimap.update()
      search.setup(updated.nodes)
      const nodeId = panel.getCurrentNodeId()
      if (nodeId) panel.refreshNeighbors(nodeId)

      if ((window as any).addActivityLog) {
        (window as any).addActivityLog(`Grafo sincronizado: ${updated.nodes.length} nodos, ${updated.edges.length} aristas.`, 'info');
      }

      // Handle autofocus queue — each pending path is consumed once matched
      const pendingQueue: string[] = (engine as any)._pendingFocusQueue ?? []
      ;(engine as any)._pendingFocusQueue = pendingQueue
      const remaining: string[] = []
      for (const rawPath of pendingQueue) {
        const targetPath = rawPath.replace(/\\/g, '/').toLowerCase()
        const cleanTarget = targetPath.replace(/^\/+|\/+$/g, '')
        const matchedNode = updated.nodes.find(node => {
          const nodePath = (node.path || '').replace(/\\/g, '/').toLowerCase()
          const cleanNode = nodePath.replace(/^\/+|\/+$/g, '')
          return cleanNode === cleanTarget || cleanNode.endsWith(cleanTarget) || cleanTarget.endsWith(cleanNode)
        })
        if (matchedNode) {
          if ((window as any).addActivityLog) {
            (window as any).addActivityLog(`Enfocando nuevo elemento importado: ${matchedNode.label} [${matchedNode.type}]`, 'success')
          }
          setTimeout(() => {
            panel.selectNode(matchedNode.id).catch(err => {
              console.error('Error auto-selecting node:', err)
            })
          }, 100)
        } else {
          remaining.push(rawPath)
        }
      }
      ;(engine as any)._pendingFocusQueue = remaining
    })
    window.addEventListener('beforeunload', unsubscribe)
  } catch (err) {
    showError(`Error minimap/búsqueda: ${(err as Error).stack ?? (err as Error).message}`)
    return
  }

  loadingEl.style.transition = 'opacity 0.5s'
  loadingEl.style.opacity = '0'
  setTimeout(() => { loadingEl.style.display = 'none' }, 500)

  document.title = 'La Gran Biblioteca'
  console.log('[LGB] Ready —', graph.nodes.length, 'nodes,', graph.edges.length, 'edges')
}

init().catch(err => console.error('[LGB] Init failed:', err))
