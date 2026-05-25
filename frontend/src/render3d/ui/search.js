import MiniSearch from 'minisearch'
import * as THREE from 'three'
import { PALETTE } from '../palette.js'
import { fetchSearch } from '../../lib/api/search'

const DEBOUNCE_MS = 160

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

export function initSearch(forceGraph, engine = null) {
  const searchInput = document.getElementById('search-input')
  const searchBtn = document.getElementById('search-btn')
  const searchResults = document.getElementById('search-results')
  const searchTypeBtn = document.getElementById('search-type-btn')
  const searchTypeDropdown = document.getElementById('search-type-dropdown')
  const searchTypeDot = document.getElementById('search-type-dot')
  const searchTypeLabel = document.getElementById('search-type-label')
  const searchModeSelect = document.getElementById('search-mode-select')
  const searchTabs = [...document.querySelectorAll('[data-search-tab]')]

  let allNodes = []
  let activeTypeFilter = null
  let debounceTimer = null
  let miniSearch = null
  let lastNodeIds = ''
  let activeTab = 'text'

  function setup(nodes) {
    const ids = nodes.map((n) => n.id).join(',')
    if (ids === lastNodeIds && miniSearch) return
    lastNodeIds = ids
    allNodes = nodes

    miniSearch = new MiniSearch({
      fields: ['name', 'label', 'id', 'topics'],
      storeFields: ['id', 'name', 'label', 'type', 'topics'],
      searchOptions: { prefix: true, fuzzy: 0.15 },
    })
    miniSearch.addAll(
      nodes.map((n) => ({
        id: n.id,
        name: String(n.name || n.id || ''),
        label: String(n.label || ''),
        type: n.type,
        topics: ((n.metadata?.topics) || []).join(' '),
      })),
    )
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
      html += `<div class="type-filter-item" data-type="${escapeHtml(t)}">
        <span class="type-dot" style="background:${color}"></span>
        <span>${escapeHtml(t)}</span>
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
      if (engine) engine.setTypeVisible(type, true)
    }
    searchTypeDropdown.querySelectorAll('.type-filter-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.type === type)
    })
    if (searchInput.value.trim()) void doSearch()
  }

  function focusNode(nodeId) {
    const graphData = forceGraph.graphData()
    const node = graphData.nodes.find((n) => n.id === nodeId)
    if (!node) return

    const distance = 150
    const distRatio = 1 + distance / Math.max(1, Math.hypot(node.x || 0, node.y || 0, node.z || 0))
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
        if (highlightMesh.parent) highlightMesh.parent.remove(highlightMesh)
        highlightMesh.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose()
        })
        highlightMat.dispose()
      }, 2000)
    }

    const infoEl = document.getElementById('info-msg')
    infoEl.textContent = node.name || node.label || node.id
    infoEl.style.color = '#4fc3f7'
    setTimeout(() => { infoEl.style.color = '' }, 3000)
  }

  function renderResults(matches) {
    if (!matches.length) {
      searchResults.innerHTML = `<div class="search-no-results">Sin resultados</div>`
      searchResults.classList.add('active')
      return
    }

    searchResults.innerHTML = matches.map((n) => {
      const color = PALETTE[n.type] || PALETTE.default
      const name = n.label || n.name || n.id
      const displayName = name.length > 42 ? name.slice(0, 39) + '...' : name
      const why = n.why || (((n.topics || []).length > 0) ? `topics: ${(n.topics || []).slice(0, 3).join(', ')}` : '')
      return `<div class="search-result-item" data-node-id="${escapeHtml(n.id)}">
        <div class="search-result-dot" style="background:${color}"></div>
        <div class="search-result-meta">
          <span class="search-result-name">${escapeHtml(displayName)}</span>
          ${why ? `<span class="search-result-why">${escapeHtml(why)}</span>` : ''}
        </div>
        <span class="search-result-type">${escapeHtml(n.type)}</span>
      </div>`
    }).join('')

    searchResults.classList.add('active')
  }

  async function doSearch() {
    const query = searchInput.value.trim()
    const mode = searchModeSelect.value || (activeTab === 'related' ? 'related' : 'text')
    const params = {
      q: query,
      mode,
      type: activeTypeFilter || '',
      limit: 20,
    }

    if (!query && mode === 'text') {
      searchResults.classList.remove('active')
      return
    }

    try {
      const response = await fetchSearch(params)
      renderResults(response.results)
      return
    } catch (_) {
      // Fallback to local search over the visible graph when the backend search fails.
    }

    if (!query || !allNodes.length || !miniSearch) {
      searchResults.classList.remove('active')
      return
    }
    let hits = miniSearch.search(query, { limit: 40 })
    if (activeTypeFilter) hits = hits.filter((h) => h.type === activeTypeFilter)
    renderResults(hits.slice(0, 20).map((hit) => ({
      id: hit.id,
      label: hit.label || hit.name || hit.id,
      type: hit.type,
      why: 'índice local',
      topics: [],
    })))
  }

  function setTab(tab) {
    activeTab = tab
    searchTabs.forEach((button) => button.classList.toggle('active', button.dataset.searchTab === tab))
    searchModeSelect.value = tab === 'related' ? 'related' : 'text'
    searchInput.placeholder = tab === 'related'
      ? 'Explorar conexiones, hubs o nodos puente…'
      : 'Buscar… (Ctrl+K)'
  }

  searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item')
    if (!item) return
    focusNode(item.dataset.nodeId)
    searchResults.classList.remove('active')
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

  searchTabs.forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.searchTab || 'text'))
  })

  searchBtn.addEventListener('click', () => { void doSearch() })
  searchModeSelect.addEventListener('change', () => { if (searchInput.value.trim()) void doSearch() })

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void doSearch() }
    if (e.key === 'Escape') { searchResults.classList.remove('active'); searchInput.blur() }
  })

  searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { void doSearch() }, DEBOUNCE_MS)
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

  function resetSearch() {
    searchInput.value = ''
    activeTypeFilter = null
    if (searchTypeDot) searchTypeDot.style.background = '#90a4ae'
    if (searchTypeLabel) searchTypeLabel.textContent = 'Todos'
    searchTypeDropdown?.classList.remove('active')
    searchResults.classList.remove('active')
    searchResults.innerHTML = ''
    setTab('text')
    if (searchModeSelect) searchModeSelect.value = 'text'
  }

  return { setup, focusNode, setTab, resetSearch }
}
