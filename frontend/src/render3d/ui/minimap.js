const WIDTH = 220
const HEIGHT = 120

function modeLabel(mode) {
  return mode === 'folder' ? 'carpetas' : mode === 'topic' ? 'topics' : 'workspace'
}

function fillColor(mode, item) {
  if (mode === 'topic') return 'rgba(102, 187, 106, 0.85)'
  if (mode === 'folder') return 'rgba(255, 167, 38, 0.85)'
  return 'rgba(79, 195, 247, 0.85)'
}

export function initMinimap(forceGraph, engine = null) {
  const minimapEl = document.getElementById('minimap')
  const minimapCanvas = document.getElementById('minimap-canvas')
  const minimapViewbox = document.getElementById('minimap-viewbox')
  const modeLabelEl = document.getElementById('minimap-mode-label')
  const metaEl = document.getElementById('minimap-meta')
  const ctx = minimapCanvas.getContext('2d')
  const chips = [...document.querySelectorAll('[data-minimap-mode]')]

  const dpr = window.devicePixelRatio || 1
  minimapCanvas.width = WIDTH * dpr
  minimapCanvas.height = HEIGHT * dpr
  ctx.scale(dpr, dpr)

  let overviewStructure = null
  let activeMode = 'workspace'
  let clickable = []

  function setStructure(data) {
    overviewStructure = data
    update()
  }

  function setMode(mode) {
    activeMode = mode
    chips.forEach((chip) => chip.classList.toggle('active', chip.dataset.minimapMode === mode))
    if (modeLabelEl) modeLabelEl.textContent = modeLabel(mode)
    update()
  }

  function updateViewbox() {
    const cam = forceGraph.camera()
    const nodes = forceGraph.graphData().nodes || []
    if (!cam || !nodes.length) return

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x || 0)
      maxX = Math.max(maxX, n.x || 0)
      minY = Math.min(minY, n.y || 0)
      maxY = Math.max(maxY, n.y || 0)
    }
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const pad = 8
    const drawW = WIDTH - pad * 2
    const drawH = HEIGHT - pad * 2
    const fov = 50 * (Math.PI / 180)
    const viewW = 2 * Math.tan(fov / 2) * Math.abs(cam.position.z) * (WIDTH / HEIGHT)
    const viewH = viewW * (HEIGHT / WIDTH)
    const vbX = pad + ((cam.position.x - minX + viewW / 2) / rangeX) * drawW
    const vbY = pad + ((cam.position.y - minY + viewH / 2) / rangeY) * drawH
    const vbW = (viewW / rangeX) * drawW
    const vbH = (viewH / rangeY) * drawH
    minimapViewbox.style.left = Math.max(0, vbX - vbW / 2) + 'px'
    minimapViewbox.style.top = Math.max(0, vbY - vbH / 2) + 'px'
    minimapViewbox.style.width = Math.min(WIDTH, vbW) + 'px'
    minimapViewbox.style.height = Math.min(HEIGHT, vbH) + 'px'
  }

  function update() {
    ctx.fillStyle = '#000011'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    clickable = []
    if (!overviewStructure) {
      metaEl.textContent = 'Sin estructura agregada'
      updateViewbox()
      return
    }
    const items = (overviewStructure.modes?.[activeMode] || []).slice(0, 12)
    metaEl.textContent = `${items.length} clusters · ${overviewStructure.total_nodes} nodos`
    if (!items.length) {
      updateViewbox()
      return
    }
    const total = items.reduce((sum, item) => sum + (item.count || 0), 0) || 1
    const cols = activeMode === 'workspace' ? 2 : 3
    const gap = 8
    const cellW = (WIDTH - gap * (cols + 1)) / cols
    const rows = Math.ceil(items.length / cols)
    const cellH = (HEIGHT - gap * (rows + 1)) / Math.max(rows, 1)
    items.forEach((item, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = gap + col * (cellW + gap)
      const y = gap + row * (cellH + gap)
      const weight = Math.max(0.18, (item.count || 0) / total)
      const w = Math.max(28, cellW * (0.75 + weight))
      const h = Math.max(18, cellH * (0.75 + weight))
      ctx.fillStyle = fillColor(activeMode, item)
      ctx.globalAlpha = 0.9
      ctx.fillRect(x, y, Math.min(w, cellW), Math.min(h, cellH))
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.strokeRect(x, y, Math.min(w, cellW), Math.min(h, cellH))
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '10px Helvetica Neue'
      ctx.fillText(String(item.label || item.key).slice(0, 16), x + 6, y + 12)
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.fillText(`${item.count || 0}`, x + 6, y + 24)
      clickable.push({ item, x, y, w: Math.min(w, cellW), h: Math.min(h, cellH) })
    })
    updateViewbox()
  }

  function applyCluster(item) {
    if (!engine) return
    if (activeMode === 'workspace') {
      engine.setGraphFilters({ workspaces: [item.key], topics: null })
      return
    }
    if (activeMode === 'topic') {
      engine.setGraphFilters({ topics: [item.key] })
      return
    }
    const targetId = item.sample_node_ids?.[0]
    if (!targetId) return
    const node = forceGraph.graphData().nodes.find((n) => n.id === targetId)
    if (!node) return
    forceGraph.cameraPosition({ x: node.x || 0, y: node.y || 0, z: 260 }, node, 900)
  }

  minimapEl.addEventListener('click', (e) => {
    const rect = minimapCanvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const hit = clickable.find((item) => (
      clickX >= item.x && clickX <= item.x + item.w && clickY >= item.y && clickY <= item.y + item.h
    ))
    if (hit) applyCluster(hit.item)
  })

  chips.forEach((chip) => chip.addEventListener('click', (e) => {
    e.stopPropagation()
    setMode(chip.dataset.minimapMode || 'workspace')
  }))

  return {
    update,
    invalidateBounds() {},
    setStructure,
    setMode,
  }
}
