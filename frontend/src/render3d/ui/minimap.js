import { saveGraphFilters } from '../viewPrefs.ts'
import {
  clearStructureNavFilters,
  filtersForCluster,
  flyToCluster,
  structureNavLabel,
} from './structureNav.ts'

const WIDTH = 220
const HEIGHT = 120
const PAD = 10
const MAX_ITEMS = 24

function modeLabel(mode) {
  return mode === 'folder' ? 'carpetas' : mode === 'topic' ? 'topics' : 'workspace'
}

function fillColor(mode, selected) {
  if (selected) return 'rgba(255, 255, 255, 0.95)'
  if (mode === 'topic') return 'rgba(102, 187, 106, 0.85)'
  if (mode === 'folder') return 'rgba(255, 167, 38, 0.85)'
  return 'rgba(79, 195, 247, 0.85)'
}

function strokeColor(mode, selected) {
  if (selected) return 'rgba(255, 255, 255, 0.95)'
  if (mode === 'topic') return 'rgba(129, 199, 132, 0.9)'
  if (mode === 'folder') return 'rgba(255, 183, 77, 0.9)'
  return 'rgba(129, 212, 250, 0.9)'
}

function truncate(text, max = 14) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function gridLayout(items) {
  const cols = items.length <= 4 ? 2 : 3
  const gap = 8
  const cellW = (WIDTH - gap * (cols + 1)) / cols
  const rows = Math.ceil(items.length / cols)
  const cellH = (HEIGHT - gap * (rows + 1)) / Math.max(rows, 1)
  return items.map((item, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const x = gap + col * (cellW + gap)
    const y = gap + row * (cellH + gap)
    const weight = Math.max(0.18, (item.count || 0) / Math.max(...items.map((i) => i.count || 1)))
    const w = Math.max(26, cellW * (0.72 + weight * 0.35))
    const h = Math.max(16, cellH * (0.72 + weight * 0.25))
    return { item, x, y, w: Math.min(w, cellW), h: Math.min(h, cellH), kind: 'rect' }
  })
}

function spreadOverlapping(layout, minGap = 3) {
  const entries = layout.filter((entry) => entry.kind === 'circle')
  if (entries.length < 2) return layout

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

  for (let iter = 0; iter < 12; iter += 1) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i]
        const b = entries[j]
        const dx = b.cx - a.cx
        const dy = b.cy - a.cy
        const dist = Math.hypot(dx, dy) || 0.01
        const minDist = a.radius + b.radius + minGap
        if (dist >= minDist) continue
        const push = (minDist - dist) / 2
        const ux = dx / dist
        const uy = dy / dist
        a.cx = clamp(a.cx - ux * push, PAD + a.radius, WIDTH - PAD - a.radius)
        a.cy = clamp(a.cy - uy * push, PAD + a.radius, HEIGHT - PAD - a.radius)
        b.cx = clamp(b.cx + ux * push, PAD + b.radius, WIDTH - PAD - b.radius)
        b.cy = clamp(b.cy + uy * push, PAD + b.radius, HEIGHT - PAD - b.radius)
      }
    }
  }
  return layout
}

function centroidLayout(items, mode) {
  const withCentroid = items.filter((item) => {
    const c = item.centroid
    return c && Number.isFinite(c.x) && Number.isFinite(c.y)
  })
  if (withCentroid.length < 2) return gridLayout(items)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const item of withCentroid) {
    minX = Math.min(minX, item.centroid.x)
    maxX = Math.max(maxX, item.centroid.x)
    minY = Math.min(minY, item.centroid.y)
    maxY = Math.max(maxY, item.centroid.y)
  }
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const maxCount = Math.max(...items.map((item) => item.count || 1))
  const sizeScale = mode === 'workspace' ? 1 : 0.72

  return spreadOverlapping(items.map((item, index) => {
    const c = item.centroid
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) {
      const fallback = gridLayout([item])[0]
      return { ...fallback, kind: 'rect' }
    }
    const cx = PAD + ((c.x - minX) / rangeX) * (WIDTH - PAD * 2)
    const cy = PAD + ((c.y - minY) / rangeY) * (HEIGHT - PAD * 2)
    const radius = (6 + Math.sqrt((item.count || 1) / maxCount) * 12) * sizeScale
    return { item, cx, cy, radius, kind: 'circle' }
  }))
}

function computeGraphBounds(nodes) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x || 0)
    maxX = Math.max(maxX, node.x || 0)
    minY = Math.min(minY, node.y || 0)
    maxY = Math.max(maxY, node.y || 0)
  }
  if (!Number.isFinite(minX)) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  }
  return { minX, maxX, minY, maxY }
}

export function initMinimap(forceGraph, engine = null, hooks = {}) {
  const minimapEl = document.getElementById('minimap')
  const minimapCanvas = document.getElementById('minimap-canvas')
  const minimapViewbox = document.getElementById('minimap-viewbox')
  const minimapList = document.getElementById('minimap-list')
  const minimapPicker = document.getElementById('minimap-picker')
  const minimapTooltip = document.getElementById('minimap-tooltip')
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
  let selectedCluster = null
  let graphBounds = null
  let hoveredKey = null
  let layoutEntries = []

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function hidePicker() {
    if (minimapPicker) {
      minimapPicker.classList.remove('active')
      minimapPicker.innerHTML = ''
    }
  }

  function hideTooltip() {
    if (minimapTooltip) {
      minimapTooltip.classList.remove('active')
      minimapTooltip.textContent = ''
    }
  }

  function syncListModeClass() {
    if (!minimapList) return
    minimapList.classList.toggle('minimap-list-dense', activeMode === 'folder' || activeMode === 'topic')
  }

  function setStructure(data) {
    overviewStructure = data
    update()
  }

  function setMode(mode) {
    activeMode = mode
    selectedCluster = null
    hoveredKey = null
    hidePicker()
    hideTooltip()
    engine?.setGraphFilters(clearStructureNavFilters())
    saveGraphFilters(engine?.getGraphFilters() || {})
    hooks.onFiltersChange?.()
    chips.forEach((chip) => chip.classList.toggle('active', chip.dataset.minimapMode === mode))
    if (modeLabelEl) modeLabelEl.textContent = modeLabel(mode)
    syncListModeClass()
    renderList()
    update()
  }

  function currentItems() {
    return (overviewStructure?.modes?.[activeMode] || []).slice(0, MAX_ITEMS)
  }

  function isSelected(item) {
    return selectedCluster?.mode === activeMode && selectedCluster?.key === item.key
  }

  function updateViewbox() {
    const cam = forceGraph.camera()
    const nodes = (forceGraph.graphData().nodes || []).filter((node) => (
      engine ? engine.isNodeGraphVisible(node) : true
    ))
    if (!cam || !nodes.length || !graphBounds) return

    const { minX, maxX, minY, maxY } = graphBounds
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const drawW = WIDTH - PAD * 2
    const drawH = HEIGHT - PAD * 2
    const fov = 50 * (Math.PI / 180)
    const viewW = 2 * Math.tan(fov / 2) * Math.abs(cam.position.z) * (WIDTH / HEIGHT)
    const viewH = viewW * (HEIGHT / WIDTH)
    const vbX = PAD + ((cam.position.x - minX + viewW / 2) / rangeX) * drawW
    const vbY = PAD + ((cam.position.y - minY + viewH / 2) / rangeY) * drawH
    const vbW = (viewW / rangeX) * drawW
    const vbH = (viewH / rangeY) * drawH
    minimapViewbox.style.left = `${Math.max(0, vbX - vbW / 2)}px`
    minimapViewbox.style.top = `${Math.max(0, vbY - vbH / 2)}px`
    minimapViewbox.style.width = `${Math.min(WIDTH, vbW)}px`
    minimapViewbox.style.height = `${Math.min(HEIGHT, vbH)}px`
  }

  function renderList() {
    if (!minimapList) return
    const items = currentItems()
    if (!items.length) {
      minimapList.innerHTML = ''
      return
    }
    minimapList.innerHTML = items.map((item) => {
      const active = isSelected(item) ? ' active' : ''
      const hovered = hoveredKey === item.key ? ' hovered' : ''
      const label = activeMode === 'folder'
        ? truncate(item.key, 28)
        : truncate(item.label || item.key, 22)
      return `<button type="button" class="minimap-list-item${active}${hovered}" data-cluster-key="${escapeHtml(item.key)}">
        <span class="minimap-list-label" title="${escapeHtml(item.label || item.key)}">${escapeHtml(label)}</span>
        <span class="minimap-list-count">${item.count || 0}</span>
      </button>`
    }).join('')
  }

  function updateMeta(items) {
    if (!metaEl) return
    if (selectedCluster) {
      metaEl.textContent = `${structureNavLabel(activeMode, selectedCluster)} · ${selectedCluster.count || 0} nodos`
      return
    }
    const total = overviewStructure?.total_nodes || 0
    const denseHint = activeMode === 'folder' || activeMode === 'topic'
      ? ' · lista o clic en zona solapada'
      : ' · clic para navegar'
    metaEl.textContent = `${items.length} clusters · ${total} nodos${denseHint}`
  }

  function drawCluster(entry) {
    const { item } = entry
    const selected = isSelected(item)
    const hovered = hoveredKey === item.key
    ctx.fillStyle = fillColor(activeMode, selected || hovered)
    ctx.strokeStyle = strokeColor(activeMode, selected || hovered)
    ctx.lineWidth = selected || hovered ? 2 : 1
    ctx.globalAlpha = selected || hovered ? 0.98 : 0.62

    if (entry.kind === 'circle') {
      ctx.beginPath()
      ctx.arc(entry.cx, entry.cy, entry.radius, 0, Math.PI * 2)
      ctx.fill()
      if (hovered && !selected) {
        ctx.globalAlpha = 1
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        ctx.stroke()
      }
      if (selected || hovered) {
        ctx.fillStyle = selected ? '#00111a' : 'rgba(255,255,255,0.95)'
        ctx.font = '9px Helvetica Neue'
        ctx.textAlign = 'center'
        ctx.globalAlpha = 1
        ctx.fillText(truncate(item.label || item.key, 10), entry.cx, entry.cy + 3)
        ctx.textAlign = 'left'
      }
      clickable.push({
        item,
        x: entry.cx - entry.radius,
        y: entry.cy - entry.radius,
        w: entry.radius * 2,
        h: entry.radius * 2,
        area: entry.radius * entry.radius,
      })
      return
    }

    ctx.fillRect(entry.x, entry.y, entry.w, entry.h)
    ctx.strokeRect(entry.x, entry.y, entry.w, entry.h)
    ctx.fillStyle = selected ? '#00111a' : 'rgba(255,255,255,0.85)'
    ctx.font = '10px Helvetica Neue'
    ctx.fillText(truncate(item.label || item.key, 12), entry.x + 5, entry.y + 11)
    ctx.fillStyle = selected ? 'rgba(0,17,26,0.65)' : 'rgba(255,255,255,0.45)'
    ctx.fillText(String(item.count || 0), entry.x + 5, entry.y + 22)
    clickable.push({ item, x: entry.x, y: entry.y, w: entry.w, h: entry.h, area: entry.w * entry.h })
  }

  function update() {
    ctx.fillStyle = '#000011'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    clickable = []
    renderList()

    if (!overviewStructure) {
      if (metaEl) metaEl.textContent = 'Sin estructura agregada'
      updateViewbox()
      return
    }

    const items = currentItems()
    updateMeta(items)
    if (!items.length) {
      updateViewbox()
      return
    }

    const visibleNodes = (forceGraph.graphData().nodes || []).filter((node) => (
      engine ? engine.isNodeGraphVisible(node) : true
    ))
    graphBounds = computeGraphBounds(visibleNodes.length ? visibleNodes : forceGraph.graphData().nodes || [])

    layoutEntries = centroidLayout(items, activeMode)
    const entryArea = (entry) => (
      entry.kind === 'circle'
        ? entry.radius * entry.radius
        : (entry.w || 0) * (entry.h || 0)
    )
    const drawOrder = [...layoutEntries].sort((a, b) => entryArea(b) - entryArea(a))
    for (const entry of drawOrder) drawCluster(entry)

    ctx.globalAlpha = 1
    updateViewbox()
  }

  function applyCluster(item) {
    if (!engine) return

    if (isSelected(item)) {
      engine.setGraphFilters(clearStructureNavFilters())
      selectedCluster = null
      saveGraphFilters(engine.getGraphFilters())
      hooks.onFiltersChange?.()
      hooks.showToast?.('Filtro estructural quitado', false)
      update()
      return
    }

    engine.setGraphFilters(filtersForCluster(activeMode, item))
    engine.refreshVisibility()
    selectedCluster = { mode: activeMode, key: item.key, label: item.label || item.key, count: item.count }
    saveGraphFilters(engine.getGraphFilters())
    hooks.onFiltersChange?.()

    const flew = flyToCluster(forceGraph, engine, item)
    const label = structureNavLabel(activeMode, item)
    hooks.showToast?.(
      flew ? `Navegando: ${label}` : `Filtrado: ${label} (sin posición 3D visible)`,
      false,
    )

    const infoEl = document.getElementById('info-msg')
    if (infoEl) {
      infoEl.textContent = label
      infoEl.style.color = '#4fc3f7'
      setTimeout(() => {
        if (infoEl.textContent === label) infoEl.textContent = ''
      }, 3500)
    }

    renderList()
    hidePicker()
    update()
  }

  function hitTestAll(clickX, clickY) {
    return clickable
      .filter((entry) => (
        clickX >= entry.x
        && clickX <= entry.x + entry.w
        && clickY >= entry.y
        && clickY <= entry.y + entry.h
      ))
      .sort((a, b) => (a.area || 0) - (b.area || 0))
  }

  function showPicker(hits, anchorX, anchorY) {
    if (!minimapPicker || hits.length < 2) return
    minimapPicker.innerHTML = `
      <div class="minimap-picker-title">${hits.length} en esta zona — elige:</div>
      ${hits.map(({ item }) => {
        const label = escapeHtml(item.label || item.key)
        return `<button type="button" class="minimap-picker-item" data-cluster-key="${escapeHtml(item.key)}">
          <span>${label}</span>
          <span class="minimap-list-count">${item.count || 0}</span>
        </button>`
      }).join('')}
    `
    minimapPicker.style.left = `${Math.min(WIDTH - 8, Math.max(8, anchorX))}px`
    minimapPicker.style.top = `${Math.min(HEIGHT - 8, Math.max(8, anchorY))}px`
    minimapPicker.classList.add('active')
  }

  function showTooltip(hits, anchorX, anchorY) {
    if (!minimapTooltip) return
    if (!hits.length) {
      hideTooltip()
      return
    }
    const lines = hits.slice(0, 4).map(({ item }) => (
      `${item.label || item.key} (${item.count || 0})`
    ))
    if (hits.length > 4) lines.push(`+${hits.length - 4} más`)
    minimapTooltip.textContent = hits.length > 1
      ? lines.join(' · ')
      : lines[0]
    minimapTooltip.style.left = `${Math.min(WIDTH - 8, Math.max(8, anchorX))}px`
    minimapTooltip.style.top = `${Math.max(4, anchorY - 28)}px`
    minimapTooltip.classList.add('active')
  }

  function setHoveredKey(key) {
    if (hoveredKey === key) return
    hoveredKey = key
    renderList()
    update()
  }

  minimapEl.addEventListener('click', (e) => {
    const pickerBtn = e.target.closest('.minimap-picker-item')
    if (pickerBtn) {
      const item = currentItems().find((entry) => entry.key === pickerBtn.dataset.clusterKey)
      hidePicker()
      if (item) applyCluster(item)
      return
    }

    const listBtn = e.target.closest('.minimap-list-item')
    if (listBtn) {
      hidePicker()
      const key = listBtn.dataset.clusterKey
      const item = currentItems().find((entry) => entry.key === key)
      if (item) applyCluster(item)
      return
    }

    if (!e.target.closest('#minimap-canvas')) return

    const rect = minimapCanvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const hits = hitTestAll(clickX, clickY)
    if (!hits.length) {
      hidePicker()
      return
    }
    if (hits.length === 1) {
      hidePicker()
      applyCluster(hits[0].item)
      return
    }
    showPicker(hits, clickX, clickY + 8)
  })

  minimapCanvas.addEventListener('mousemove', (e) => {
    const rect = minimapCanvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hits = hitTestAll(x, y)
    if (!hits.length) {
      if (hoveredKey) setHoveredKey(null)
      hideTooltip()
      return
    }
    setHoveredKey(hits[0].item.key)
    showTooltip(hits, x, y)
  })

  minimapCanvas.addEventListener('mouseleave', () => {
    setHoveredKey(null)
    hideTooltip()
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#minimap')) hidePicker()
  })

  chips.forEach((chip) => chip.addEventListener('click', (e) => {
    e.stopPropagation()
    setMode(chip.dataset.minimapMode || 'workspace')
  }))

  syncListModeClass()

  return {
    update,
    invalidateBounds() {
      graphBounds = null
    },
    setStructure,
    setMode,
  }
}
