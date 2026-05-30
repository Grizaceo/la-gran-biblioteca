export function initFocus(forceGraph, engine, getCurrentNodeId) {
  const focusBanner = document.getElementById('focus-banner')
  const focusName   = document.getElementById('focus-name')
  const focusBack   = document.getElementById('focus-back')
  const btnFocus    = document.getElementById('btn-focus')
  const breadcrumb  = document.getElementById('breadcrumb')
  const searchInput = document.getElementById('search-input')

  let focusHistory     = []
  let currentFocusNode = null
  let lastHoveredNode  = null

  function restoreAll() {
    const { nodes, links } = forceGraph.graphData()
    for (const n of nodes) {
      n.__focusVisible = undefined
    }
    for (const l of links) {
      l.__focusVisible = undefined
    }
    engine.setFocusMode(false)
  }

  function collectNeighborsAtDepth(startId, depth) {
    const { links } = forceGraph.graphData()
    const neighborIds = new Set([startId])
    let frontier = [startId]
    const hops = Math.max(1, Math.min(3, depth || 1))
    for (let d = 0; d < hops; d += 1) {
      const next = []
      for (const nid of frontier) {
        for (const l of links) {
          const src = typeof l.source === 'object' ? l.source.id : l.source
          const tgt = typeof l.target === 'object' ? l.target.id : l.target
          if (src === nid && !neighborIds.has(tgt)) {
            neighborIds.add(tgt)
            next.push(tgt)
          }
          if (tgt === nid && !neighborIds.has(src)) {
            neighborIds.add(src)
            next.push(src)
          }
        }
      }
      frontier = next
    }
    return neighborIds
  }

  function enterFocusMode(nodeId, depth = 1) {
    const { nodes } = forceGraph.graphData()
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    focusHistory.push({ nodeId, cameraPos: forceGraph.camera().position.clone() })

    const neighborIds = collectNeighborsAtDepth(nodeId, depth)

    engine.setFocusMode(true)

    for (const n of nodes) {
      const v = neighborIds.has(n.id) && engine.isNodeGraphVisible(n)
      n.__focusVisible = v
      if (n.__threeObj) n.__threeObj.visible = v
    }
    for (const l of links) {
      const src = typeof l.source === 'object' ? l.source.id : l.source
      const tgt = typeof l.target === 'object' ? l.target.id : l.target
      const v = neighborIds.has(src) && neighborIds.has(tgt) && engine.isLinkGraphVisible(l)
      l.__focusVisible = v
      const obj = l.__lineObj || l.__arrowObj
      if (obj) obj.visible = v
    }

    focusName.textContent = node.name || node.id
    focusBanner.classList.add('active')
    currentFocusNode = nodeId

    setTimeout(() => {
      const dist  = 120
      const ratio = 1 + dist / Math.hypot(node.x || 0, node.y || 0, node.z || 0)
      forceGraph.cameraPosition(
        { x: (node.x || 0) * ratio, y: (node.y || 0) * ratio, z: (node.z || 0) * ratio },
        node, 800,
      )
    }, 100)

    updateBreadcrumb()
  }

  function exitFocusMode() {
    if (!focusHistory.length) return
    focusHistory.pop()
    restoreAll()
    focusBanner.classList.remove('active')
    currentFocusNode = null

    if (focusHistory.length > 0) {
      enterFocusMode(focusHistory[focusHistory.length - 1].nodeId)
    }
    updateBreadcrumb()
  }

  function clearAllFocus() {
    focusHistory = []
    restoreAll()
    focusBanner.classList.remove('active')
    currentFocusNode = null
    updateBreadcrumb()
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function updateBreadcrumb() {
    if (!focusHistory.length) {
      breadcrumb.classList.remove('active')
      breadcrumb.innerHTML = ''
      return
    }
    const { nodes } = forceGraph.graphData()
    breadcrumb.classList.add('active')
    let html = ''
    focusHistory.forEach((entry, i) => {
      const node      = nodes.find(n => n.id === entry.nodeId)
      const name      = node ? (node.name || node.id) : entry.nodeId
      const shortName = name.length > 20 ? name.slice(0, 18) + '…' : name
      if (i > 0) html += '<span class="bc-sep">›</span>'
      if (i === focusHistory.length - 1) {
        html += `<span class="bc-item">${escHtml(shortName)}</span>`
      } else {
        html += `<span class="bc-item" data-focus-idx="${i}">${escHtml(shortName)}</span>`
      }
    })
    breadcrumb.innerHTML = html
  }

  breadcrumb.addEventListener('click', (e) => {
    const item = e.target.closest('.bc-item[data-focus-idx]')
    if (!item) return
    const idx = parseInt(item.dataset.focusIdx, 10)
    while (focusHistory.length > idx + 1) focusHistory.pop()
    restoreAll()
    if (focusHistory.length > 0) {
      enterFocusMode(focusHistory[focusHistory.length - 1].nodeId)
    } else {
      focusBanner.classList.remove('active')
      currentFocusNode = null
      updateBreadcrumb()
    }
  })

  focusBack.addEventListener('click', exitFocusMode)

  btnFocus.addEventListener('click', () => {
    if (currentFocusNode) {
      exitFocusMode()
    } else if (lastHoveredNode) {
      enterFocusMode(lastHoveredNode.id)
    } else {
      const panelNodeId = getCurrentNodeId?.()
      if (panelNodeId) {
        enterFocusMode(panelNodeId)
      } else {
        focusName.textContent = 'Hover a node first'
        focusBanner.classList.add('active')
        setTimeout(() => { if (!currentFocusNode) focusBanner.classList.remove('active') }, 2000)
      }
    }
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && document.activeElement !== searchInput) {
      e.preventDefault()
      btnFocus.click()
    }
    if (e.key === 'Escape' && currentFocusNode) {
      e.preventDefault()
      exitFocusMode()
    }
  })

  return {
    setHoveredNode(node) { lastHoveredNode = node },
    enterFocusMode,
    clearAllFocus,
    enterAgentFocus(nodeId, depth = 2) {
      enterFocusMode(nodeId, depth)
    },
  }
}
