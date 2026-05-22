import { PALETTE } from '../palette.js'

export function initMinimap(forceGraph, engine = null) {
  const minimapEl      = document.getElementById('minimap')
  const minimapCanvas  = document.getElementById('minimap-canvas')
  const minimapViewbox = document.getElementById('minimap-viewbox')
  const ctx            = minimapCanvas.getContext('2d')

  const dpr = window.devicePixelRatio || 1
  minimapCanvas.width  = 180 * dpr
  minimapCanvas.height = 120 * dpr
  ctx.scale(dpr, dpr)

  let cachedBounds = null

  function getBounds(nodes) {
    if (cachedBounds) return cachedBounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodes) {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    cachedBounds = { minX, maxX, minY, maxY }
    return cachedBounds
  }

  function update() {
    const { nodes } = forceGraph.graphData()
    if (!nodes.length) return

    const { minX, maxX, minY, maxY } = getBounds(nodes)
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const pad = 8
    const drawW = 180 - pad * 2
    const drawH = 120 - pad * 2

    ctx.fillStyle = '#000011'
    ctx.fillRect(0, 0, 180, 120)

    const stride = Math.max(1, engine?.minimapStride ?? 1)
    for (let i = 0; i < nodes.length; i += stride) {
      const n = nodes[i]
      const x = pad + ((n.x - minX) / rangeX) * drawW
      const y = pad + ((n.y - minY) / rangeY) * drawH
      const isVisible = n.__focusVisible !== false && n.__filterVisible !== false
      ctx.fillStyle = isVisible ? (PALETTE[n.type] || PALETTE.default) : 'rgba(100,100,100,0.2)'
      ctx.beginPath()
      ctx.arc(x, y, isVisible ? 1.5 : 0.8, 0, Math.PI * 2)
      ctx.fill()
    }

    const cam = forceGraph.camera()
    if (cam) {
      const fov  = 50 * (Math.PI / 180)
      const viewW = 2 * Math.tan(fov / 2) * Math.abs(cam.position.z) * (180 / 120)
      const viewH = viewW * (120 / 180)
      const vbX  = pad + ((cam.position.x - minX + viewW / 2) / rangeX) * drawW
      const vbY  = pad + ((cam.position.y - minY + viewH / 2) / rangeY) * drawH
      const vbW  = (viewW / rangeX) * drawW
      const vbH  = (viewH / rangeY) * drawH
      minimapViewbox.style.left   = Math.max(0, vbX - vbW / 2) + 'px'
      minimapViewbox.style.top    = Math.max(0, vbY - vbH / 2) + 'px'
      minimapViewbox.style.width  = Math.min(180, vbW) + 'px'
      minimapViewbox.style.height = Math.min(120, vbH) + 'px'
    }
  }

  function invalidateBounds() { cachedBounds = null }

  minimapEl.addEventListener('click', (e) => {
    const { nodes } = forceGraph.graphData()
    if (!nodes.length) return
    const rect   = minimapEl.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const { minX, maxX, minY, maxY } = getBounds(nodes)
    const pad   = 8
    const drawW = 180 - pad * 2
    const drawH = 120 - pad * 2
    const worldX = minX + ((clickX - pad) / drawW) * (maxX - minX)
    const worldY = minY + ((clickY - pad) / drawH) * (maxY - minY)
    forceGraph.cameraPosition({ x: worldX, y: worldY, z: forceGraph.camera().position.z }, null, 600)
  })

  return { update, invalidateBounds }
}
