import { fetchGraph, fetchNode, fetchNodeContent, openNode, studyNode, subscribeToUpdates } from './lib/bridge'
import type { Node, Graph } from './lib/bridge'
import { Graph3DEngine } from './render3d/Graph3DEngine'
import { initSearch } from './render3d/ui/search.js'
import { initMinimap } from './render3d/ui/minimap.js'
import { initFocus } from './render3d/ui/focus.js'
import { initVisibility } from './render3d/ui/visibility.js'
import { PALETTE } from './render3d/palette.js'
import { marked } from 'marked'
import hljs from 'highlight.js'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const container   = document.getElementById('graph-container')!
  const loadingText = document.getElementById('loading-text')!
  const loadingErr  = document.getElementById('loading-error')!
  const statsEl     = document.getElementById('stats')!
  const statusEl    = document.getElementById('status')!
  const loadingEl   = document.getElementById('loading')!

  // Detail panel refs
  const detailPanel     = document.getElementById('node-detail')!
  const detailName      = document.getElementById('node-detail-name')!
  const detailType      = document.getElementById('node-detail-type')!
  const detailPath      = document.getElementById('node-detail-path')!
  const detailMeta      = document.getElementById('node-detail-meta')!
  const detailClose     = document.getElementById('node-detail-close')!
  const detailActions   = document.getElementById('node-detail-actions')!
  const detailPreview   = document.getElementById('node-detail-preview')!
  const detailNeighbors = document.getElementById('node-detail-neighbors')!

  let currentGraph: Graph | null = null
  let currentNodeId: string | null = null

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

  // ── Panel helpers (defined after engine exists) ──────────────────────────

  function closePanel(): void {
    detailPanel.classList.remove('active')
    container.style.right = '0'
    engine.resume()
    // Force canvas resize after transition
    setTimeout(() => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
    }, 320)
    currentNodeId = null
  }

  detailClose.addEventListener('click', closePanel)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailPanel.classList.contains('active')) closePanel()
  })

  function renderNeighbors(nodeId: string): void {
    if (!currentGraph) { detailNeighbors.innerHTML = ''; return }

    const neighborIds = new Set<string>()
    for (const edge of currentGraph.edges) {
      if (edge.source === nodeId) neighborIds.add(edge.target)
      else if (edge.target === nodeId) neighborIds.add(edge.source)
    }

    const neighbors = currentGraph.nodes.filter(n => neighborIds.has(n.id)).slice(0, 30)
    if (!neighbors.length) { detailNeighbors.innerHTML = ''; return }

    const more = neighborIds.size > 30
      ? `<div class="neighbor-more">+${neighborIds.size - 30} más</div>`
      : ''

    detailNeighbors.innerHTML = `
      <div class="detail-section-title">Vecinos (${neighborIds.size})</div>
      <div class="neighbor-list">
        ${neighbors.map(n => {
          const color = (PALETTE as Record<string, string>)[n.type] ?? (PALETTE as Record<string, string>).default
          const name = n.label || n.id
          const short = name.length > 36 ? name.slice(0, 34) + '…' : name
          return `<div class="neighbor-item" data-id="${n.id}">
            <span class="neighbor-dot" style="background:${color}"></span>
            <span class="neighbor-name">${short}</span>
            <span class="neighbor-type">${n.type}</span>
          </div>`
        }).join('')}
        ${more}
      </div>`

    detailNeighbors.querySelectorAll('.neighbor-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id!
        selectNode(id)
      })
    })
  }

  const NON_FILE_TYPES = new Set(['folder', 'workspace', 'project'])

  async function renderPreview(node: Node): Promise<void> {
    if (NON_FILE_TYPES.has(node.type) || !node.path) {
      detailPreview.innerHTML = ''
      return
    }

    detailPreview.innerHTML = '<div class="preview-loading">Cargando vista previa…</div>'

    try {
      const result = await fetchNodeContent(node.id)
      const { content, lang, truncated } = result

      let html = ''
      if (lang === 'markdown') {
        html = await Promise.resolve(marked.parse(content))
      } else {
        const highlighted = lang
          ? hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(content).value
        html = `<pre class="hljs"><code>${highlighted}</code></pre>`
      }

      const truncNote = truncated
        ? '<div class="preview-truncated">Vista previa truncada a 2 MB — usa "Abrir" para ver el archivo completo.</div>'
        : ''

      detailPreview.innerHTML = `
        <div class="detail-section-title">Vista previa</div>
        ${truncNote}
        <div class="preview-content markdown-body">${html}</div>`
    } catch (err: unknown) {
      const status = err instanceof Error ? err.message : String(err)
      if (status === '415') {
        detailPreview.innerHTML = '<div class="preview-unavailable">Vista previa no disponible para este tipo · usa "Abrir".</div>'
      } else if (status === '403') {
        detailPreview.innerHTML = ''
      } else {
        detailPreview.innerHTML = '<div class="preview-unavailable">No se pudo cargar la vista previa.</div>'
      }
    }
  }

  function renderActions(node: Node): void {
    const hasPath = !!node.path && !NON_FILE_TYPES.has(node.type)
    if (!hasPath) { detailActions.innerHTML = ''; return }

    detailActions.innerHTML = `
      <button class="detail-btn" id="btn-open-file">Abrir</button>
      <button class="detail-btn" id="btn-reveal-file">Revelar</button>`

    document.getElementById('btn-open-file')!.addEventListener('click', async () => {
      try {
        await openNode(node.id, false)
      } catch {
        showToast('No se pudo abrir. Verifica que LGB_ALLOW_OPEN=1 está activo.', true)
      }
    })

    document.getElementById('btn-reveal-file')!.addEventListener('click', async () => {
      try {
        await openNode(node.id, true)
      } catch {
        showToast('No se pudo revelar el archivo.', true)
      }
    })
  }

  async function renderDetailPanel(node: Node): Promise<void> {
    const color = (PALETTE as Record<string, string>)[node.type] ?? (PALETTE as Record<string, string>).default
    detailName.textContent      = node.label
    detailType.textContent      = node.type
    detailType.style.background = color
    detailPath.textContent      = node.path ?? ''

    const meta = node.metadata ?? {}
    const rows = Object.entries(meta)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<div class="detail-meta-row"><span>${k}</span><span>${String(v)}</span></div>`)
      .join('')
    detailMeta.innerHTML = rows
      || '<div class="detail-meta-row"><span style="opacity:.4">sin metadatos</span></div>'

    renderActions(node)
    renderNeighbors(node.id)

    detailPanel.classList.add('active')
    container.style.right = '480px'
    // Resize renderer
    setTimeout(() => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
    }, 50)
    engine.pause()

    renderPreview(node).catch(() => {})
  }

  async function selectNode(nodeId: string): Promise<void> {
    const graphData = engine.fg.graphData()
    const graphNode = graphData.nodes.find((n: Record<string, unknown>) => n.id === nodeId)

    if (graphNode) {
      const nx = (graphNode.x as number) || 0
      const ny = (graphNode.y as number) || 0
      const nz = (graphNode.z as number) || 0
      const dist = 80
      const hyp  = Math.hypot(nx, ny, nz) || 1
      const ratio = 1 + dist / hyp
      engine.fg.cameraPosition(
        { x: nx * ratio, y: ny * ratio, z: nz * ratio },
        { x: nx, y: ny, z: nz },
        800,
      )
    }

    try {
      await studyNode(nodeId)
      const detail = await fetchNode(nodeId)
      currentNodeId = nodeId
      await renderDetailPanel(detail)
    } catch (err) {
      console.warn('[LGB] selectNode failed:', err)
    }
  }

  // ── UI wiring ────────────────────────────────────────────────────────────

  step('3/6 Conectando UI…')
  try {
    const focus = initFocus(engine.fg)
    initVisibility(engine)

    const tooltip = document.createElement('div')
    tooltip.id = 'node-tooltip'
    document.body.appendChild(tooltip)

    let mouseX = 0
    let mouseY = 0
    let isHovering = false

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX
      mouseY = e.clientY
      if (isHovering) positionTooltip()
    })

    function positionTooltip(): void {
      const tw = tooltip.offsetWidth
      const th = tooltip.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let x = mouseX + 16
      let y = mouseY - 12
      if (x + tw > vw - 8) x = mouseX - tw - 16
      if (y + th > vh - 8) y = vh - th - 8
      tooltip.style.left = x + 'px'
      tooltip.style.top  = y + 'px'
    }

    engine.onNodeHover((node) => {
      if (node) {
        const name  = (node.name as string) || (node.id as string)
        const type  = (node.type as string) || 'unknown'
        const path  = (node.path as string) || ''
        const color = (PALETTE as Record<string, string>)[type] ?? (PALETTE as Record<string, string>).default
        const pathShort = path.length > 48 ? '…' + path.slice(-47) : path

        tooltip.innerHTML = `
          <div class="tt-name">${name}</div>
          <div class="tt-type"><span class="tt-dot" style="background:${color}"></span>${type}</div>
          ${pathShort ? `<div class="tt-path">${pathShort}</div>` : ''}
        `
        isHovering = true
        tooltip.classList.add('active')
        positionTooltip()
        container.style.cursor = 'pointer'
        focus.setHoveredNode(node)
      } else {
        isHovering = false
        tooltip.classList.remove('active')
        container.style.cursor = 'grab'
        focus.setHoveredNode(null)
      }
    })

    engine.onNodeClick(async (node) => {
      await selectNode(node.id as string)
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
      if (currentNodeId) renderNeighbors(currentNodeId)
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
