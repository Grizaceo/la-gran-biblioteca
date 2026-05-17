import * as THREE from 'three'
import { PALETTE } from '../palette.js'

const DEBOUNCE_MS = 120

export function initSearch(forceGraph) {
  const searchInput        = document.getElementById('search-input')
  const searchBtn          = document.getElementById('search-btn')
  const searchResults      = document.getElementById('search-results')
  const searchTypeBtn      = document.getElementById('search-type-btn')
  const searchTypeDropdown = document.getElementById('search-type-dropdown')
  const searchTypeDot      = document.getElementById('search-type-dot')
  const searchTypeLabel    = document.getElementById('search-type-label')

  let allNodes         = []
  let nodesByType      = new Map()
  let activeTypeFilter = null
  let debounceTimer    = null

  function setup(nodes) {
    allNodes = nodes
    nodesByType = new Map()
    for (const n of nodes) {
      if (!nodesByType.has(n.type)) nodesByType.set(n.type, [])
      nodesByType.get(n.type).push(n)
    }
    buildTypeDropdown()
  }

  function buildTypeDropdown() {
    const typeCounts = {}
    for (const n of allNodes) typeCounts[n.type] = (typeCounts[n.type] || 0) + 1
    const types = Object.keys(typeCounts).sort()

    let html = `<div class="type-filter-item active" data-type="all">
      <span class="type-dot" style="background:#90a4ae"></span>
      <span>Todos</span>
      <span class="type-count">${allNodes.length}</span>
    </div>`

    for (const t of types) {
      const color = PALETTE[t] || PALETTE.default
      html += `<div class="type-filter-item" data-type="${t}">
        <span class="type-dot" style="background:${color}"></span>
        <span>${t}</span>
        <span class="type-count">${typeCounts[t]}</span>
      </div>`
    }
    searchTypeDropdown.innerHTML = html
  }

  function setTypeFilter(type) {
    if (type === 'all') {
      activeTypeFilter = null
      searchTypeDot.style.background = '#90a4ae'
      searchTypeLabel.textContent = 'Todos'
    } else {
      activeTypeFilter = type
      searchTypeDot.style.background = PALETTE[type] || PALETTE.default
      searchTypeLabel.textContent = type
    }
    searchTypeDropdown.querySelectorAll('.type-filter-item').forEach(item => {
      item.classList.toggle('active', item.dataset.type === type)
    })
    if (searchInput.value.trim()) doSearch()
  }

  function focusNode(nodeId) {
    const graphData = forceGraph.graphData()
    const node = graphData.nodes.find(n => n.id === nodeId)
    if (!node) return

    const distance = 150
    const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0)
    forceGraph.cameraPosition(
      { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
      node, 1000,
    )

    const originalObj = node.__threeObj
    if (originalObj) {
      const highlightMesh = originalObj.clone()
      highlightMesh.scale.set(2.5, 2.5, 2.5)
      const highlightMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.6, wireframe: true,
      })
      highlightMesh.material = highlightMat
      originalObj.parent.add(highlightMesh)
      setTimeout(() => {
        if (originalObj.parent) originalObj.parent.remove(highlightMesh)
        highlightMesh.geometry.dispose()
        highlightMat.dispose()
      }, 2000)
    }

    const infoEl = document.getElementById('info-msg')
    infoEl.textContent = node.name || node.id
    infoEl.style.color = '#4fc3f7'
    setTimeout(() => { infoEl.style.color = '' }, 3000)
  }

  function doSearch() {
    const query = searchInput.value.trim().toLowerCase()
    if (!query || !allNodes.length) {
      searchResults.classList.remove('active')
      return
    }

    const pool = activeTypeFilter ? (nodesByType.get(activeTypeFilter) || []) : allNodes
    const matches = pool.filter(n => {
      const name  = (n.name || n.id || '').toLowerCase()
      const label = (n.label || '').toLowerCase()
      return name.includes(query) || label.includes(query)
    }).slice(0, 20)

    if (!matches.length) {
      const typeLabel = activeTypeFilter ? ` en "${activeTypeFilter}"` : ''
      searchResults.innerHTML = `<div class="search-no-results">Sin resultados${typeLabel}</div>`
      searchResults.classList.add('active')
      return
    }

    searchResults.innerHTML = matches.map(n => {
      const color = PALETTE[n.type] || PALETTE.default
      const name = n.name || n.id
      const displayName = name.length > 40 ? name.slice(0, 37) + '...' : name
      return `<div class="search-result-item" data-node-id="${n.id}">
        <div class="search-result-dot" style="background:${color}"></div>
        <span class="search-result-name">${displayName}</span>
        <span class="search-result-type">${n.type}</span>
      </div>`
    }).join('')

    searchResults.classList.add('active')
  }

  searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item')
    if (!item) return
    focusNode(item.dataset.nodeId)
    searchResults.classList.remove('active')
    searchInput.value = ''
  })

  searchTypeDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.type-filter-item')
    if (!item) return
    setTypeFilter(item.dataset.type)
    searchTypeDropdown.classList.remove('active')
  })

  searchTypeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    searchTypeDropdown.classList.toggle('active')
  })

  searchBtn.addEventListener('click', doSearch)

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch() }
    if (e.key === 'Escape') { searchResults.classList.remove('active'); searchInput.blur() }
  })

  searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(doSearch, DEBOUNCE_MS)
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-container')) {
      searchTypeDropdown.classList.remove('active')
      searchResults.classList.remove('active')
    }
  })

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      searchInput.focus()
      searchInput.select()
    }
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault()
      searchInput.focus()
    }
  })

  return { setup, focusNode }
}
