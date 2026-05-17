import { fetchGraph, fetchNode, studyNode, subscribeToUpdates } from './lib/bridge'
import type { Node, Graph } from './lib/bridge'
import { Graph3DEngine } from './render3d/Graph3DEngine'
import { initSearch } from './render3d/ui/search.js'
import { initMinimap } from './render3d/ui/minimap.js'
import { initFocus } from './render3d/ui/focus.js'
import { PALETTE } from './render3d/palette.js'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const container   = document.getElementById('graph-container')!
  const loadingText = document.getElementById('loading-text')!
  const loadingErr  = document.getElementById('loading-error')!
  const statsEl     = document.getElementById('stats')!
  const statusEl    = document.getElementById('status')!
  const loadingEl   = document.getElementById('loading')!

  // Detail panel refs
  const detailPanel = document.getElementById('node-detail')!
  const detailName  = document.getElementById('node-detail-name')!
  const detailType  = document.getElementById('node-detail-type')!
  const detailPath  = document.getElementById('node-detail-path')!
  const detailMeta  = document.getElementById('node-detail-meta')!
  const detailClose = document.getElementById('node-detail-close')!
  detailClose.addEventListener('click', () => detailPanel.classList.remove('active'))

  function renderDetailPanel(node: Node): void {
    const color = (PALETTE as Record<string, string>)[node.type] ?? PALETTE.default
    detailName.textContent       = node.label
    detailType.textContent       = node.type
    detailType.style.background  = color
    detailPath.textContent       = node.path ?? ''
    const meta = node.metadata ?? {}
    const rows = Object.entries(meta)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<div class="detail-meta-row"><span>${k}</span><span>${String(v)}</span></div>`)
      .join('')
    detailMeta.innerHTML = rows || '<div class="detail-meta-row"><span style="opacity:.4">sin metadatos</span></div>'
    detailPanel.classList.add('active')
  }

  function showError(msg: string): void {
    loadingText.style.display = 'none'
    ;(loadingEl.querySelector('.spinner') as HTMLElement).style.display = 'none'
    loadingErr.style.display = 'block'
    loadingErr.textContent   = msg
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

  step('2/6 Iniciando motor 3D…')
  let engine: Graph3DEngine
  try {
    engine = new Graph3DEngine(container)
  } catch (err) {
    showError(`Error motor 3D: ${(err as Error).stack ?? (err as Error).message}`)
    return
  }

  step('3/6 Conectando UI…')
  try {
    const focus = initFocus(engine.fg)

    engine.onNodeHover((node) => {
      const infoEl = document.getElementById('info-msg')!
      if (node) {
        infoEl.textContent = (node.name as string) || (node.id as string)
        container.style.cursor = 'pointer'
        focus.setHoveredNode(node)
      } else {
        infoEl.textContent = ''
        container.style.cursor = 'grab'
        focus.setHoveredNode(null)
      }
    })

    engine.onNodeClick(async (node) => {
      const nodeId = node.id as string
      try {
        await studyNode(nodeId)
        const detail = await fetchNode(nodeId)
        renderDetailPanel(detail)
      } catch (err) {
        console.warn('[LGB] node click failed:', err)
      }
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

  step('5/6 Iniciando minimap y búsqueda…')
  try {
    const minimap = initMinimap(engine.fg)
    const search  = initSearch(engine.fg)

    engine.onMinimapTick = () => minimap.update()
    engine.fg.onEngineStop(() => minimap.invalidateBounds())

    search.setup(graph.nodes)
    minimap.update()

    const unsubscribe = subscribeToUpdates((updated: Graph) => {
      engine.applyUpdate(updated)
      statsEl.textContent = `${updated.nodes.length} nodos · ${updated.edges.length} aristas`
      minimap.invalidateBounds()
      minimap.update()
      search.setup(updated.nodes)
    })
    window.addEventListener('beforeunload', unsubscribe)
  } catch (err) {
    showError(`Error minimap/búsqueda: ${(err as Error).stack ?? (err as Error).message}`)
    return
  }

  // fade out then hide
  loadingEl.style.transition = 'opacity 0.5s'
  loadingEl.style.opacity = '0'
  setTimeout(() => { loadingEl.style.display = 'none' }, 500)

  document.title = 'La Gran Biblioteca'
  console.log('[LGB] Ready —', graph.nodes.length, 'nodes,', graph.edges.length, 'edges')
}

init().catch(err => console.error('[LGB] Init failed:', err))
