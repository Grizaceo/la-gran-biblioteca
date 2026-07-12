import type { Node, Graph } from '../lib/bridge'
import {
  fetchNode,
  fetchConstellationPrefs,
  fetchConstellationCatalog,
  saveConstellationPref,
  deleteConstellationPref,
} from '../lib/bridge'
import { loadConstellationDetail } from '../services/constellationService'
import { PALETTE } from '../render3d/palette.js'
import { CONSTELLATION_DETAIL_SECTION } from './constellationCopy'
import { findFolderNodeId, flyCameraToNode } from './constellationFlyTo'
import type { ConstellationSettingsAPI } from './constellationSettings'
import { escapeHtml } from '../lib/utils'

function escapeAttr(s: string | null | undefined): string {
  return escapeHtml(s)
}

export interface MetaContext {
  detailNeighbors: HTMLElement
  detailMeta: HTMLElement
  getCurrentGraph: () => Graph | null
  showToast: (msg: string, isError?: boolean) => void
  selectNode: (id: string) => void
  constellationSettings?: ConstellationSettingsAPI
  fetchNode: typeof fetchNode
  fetchConstellationPrefs: typeof fetchConstellationPrefs
  fetchConstellationCatalog: typeof fetchConstellationCatalog
  saveConstellationPref: typeof saveConstellationPref
  deleteConstellationPref: typeof deleteConstellationPref
  engine: { fg: any }
  /** Re-render the full detail panel for a node (used after constellation pref changes). */
  renderDetailPanel: (node: Node) => Promise<void>
}

export function setupDetailMeta(ctx: MetaContext): {
  renderNeighbors: (nodeId: string) => void
  renderFolderConstellation: (node: Node) => Promise<string>
  bindFolderConstellationHandlers: (node: Node) => void
} {
  const { detailNeighbors, getCurrentGraph, showToast, selectNode, engine } = ctx

  let catalogCache: Array<{ id: string; name: string; name_es?: string }> | null = null

  async function getCatalog() {
    if (!catalogCache) {
      const data = await ctx.fetchConstellationCatalog()
      catalogCache = data.constellations
    }
    return catalogCache
  }

  function labelForConstellation(id: string, catalog: Array<{ id: string; name: string; name_es?: string }>) {
    const c = catalog.find((x) => x.id === id)
    return c ? (c.name_es || c.name) : id
  }

  async function renderConstellationCard(
    cid: string,
    folderLabel: string,
    status: string | undefined,
  ): Promise<string> {
    if (status !== 'confirmed') return ''
    try {
      const detail = await loadConstellationDetail(cid)
      const cname = detail.name_es || detail.name
      const summary = detail.summary_es
        ? `<p class="detail-constellation-summary">${escapeHtml(detail.summary_es)}</p>`
        : ''
      const season = detail.season
        ? `<div class="detail-meta-row"><span>Época</span><span>${escapeHtml(detail.season)}</span></div>`
        : ''
      const namedStars = (detail.stars || [])
        .filter((s) => s.name && !String(s.name).includes('_'))
        .slice(0, 5)
        .map((s) => s.name)
        .join(', ')
      const starsRow = namedStars
        ? `<div class="detail-meta-row"><span>Estrellas</span><span>${escapeHtml(namedStars)}</span></div>`
        : ''
      return `<div class="detail-constellation-card">
        <p class="detail-constellation-lead">Tu carpeta <strong>${escapeHtml(folderLabel)}</strong> está mapeada a <strong>${escapeHtml(cname)}</strong> en el cielo.</p>
        ${summary}
        ${season}
        ${starsRow}
        <button type="button" class="detail-btn" id="btn-fly-constellation">Ver en el grafo</button>
      </div>`
    } catch {
      return ''
    }
  }

  async function renderFolderConstellation(node: Node): Promise<string> {
    if (!node.path) return ''
    const catalog = await getCatalog()
    let pref = null
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')
    try {
      const { prefs } = await ctx.fetchConstellationPrefs()
      const np = norm(node.path!)
      pref = prefs.find((p) => norm(p.folder_path) === np) ?? null
    } catch {
      pref = null
    }
    const meta = node.metadata || {}
    const cid = pref?.constellation_id || (meta.constellation_id as string | undefined)
    const status = pref?.status || (meta.constellation_status as string | undefined)
    const folderLabel = node.label || node.path.split(/[/\\]/).pop() || node.path
    if (!cid && !pref) {
      return `<div class="detail-section-title">${escapeHtml(CONSTELLATION_DETAIL_SECTION)}</div>
        <div class="detail-meta-row"><span>Sin asignar</span></div>`
    }
    const statusLabel = status === 'confirmed' ? 'Confirmada' : 'Sugerida'
    const options = catalog
      .map((c) => `<option value="${escapeAttr(c.id)}" ${c.id === cid ? 'selected' : ''}>${escapeHtml(c.name_es || c.name)}</option>`)
      .join('')
    const card = cid ? await renderConstellationCard(cid, folderLabel, status) : ''
    return `<div class="detail-section-title">${escapeHtml(CONSTELLATION_DETAIL_SECTION)}</div>
      <div class="detail-meta-row"><span>Estado</span><span>${escapeHtml(statusLabel)}</span></div>
      <div class="detail-meta-row"><span>Patrón</span><span>${escapeHtml(labelForConstellation(cid || '', catalog))}</span></div>
      ${card}
      <label class="detail-constellation-picker">
        <span>Cambiar</span>
        <select id="detail-constellation-select">${options}</select>
      </label>
      <div class="detail-constellation-btns">
        ${status === 'suggested' ? '<button class="detail-btn" id="btn-confirm-constellation">Confirmar sugerencia</button>' : ''}
        <button class="detail-btn" id="btn-save-constellation">Guardar</button>
        <button class="detail-btn detail-btn-muted" id="btn-clear-constellation">Quitar</button>
      </div>`
  }

  function bindFolderConstellationHandlers(node: Node): void {
    const confirmBtn = document.getElementById('btn-confirm-constellation')
    const saveBtn = document.getElementById('btn-save-constellation')
    const clearBtn = document.getElementById('btn-clear-constellation')
    const select = document.getElementById('detail-constellation-select') as HTMLSelectElement | null

    const save = async (status: 'confirmed' | 'suggested') => {
      if (!node.path || !select?.value) return
      try {
        await ctx.saveConstellationPref(node.path, select.value, status)
        if (status === 'confirmed') {
          ctx.constellationSettings?.notifyConfirmedWithoutLayout()
        }
        showToast('Constelación guardada')
        await ctx.renderDetailPanel(await ctx.fetchNode(node.id))
      } catch (err) {
        showToast(`Error: ${(err as Error).message}`, true)
      }
    }

    document.getElementById('btn-fly-constellation')?.addEventListener('click', () => {
      if (!node.path) return
      const nodeId = findFolderNodeId(getCurrentGraph(), node.path)
      if (!nodeId || !flyCameraToNode(engine.fg, nodeId)) {
        showToast('No se pudo centrar la cámara en esta carpeta', true)
      }
    })

    confirmBtn?.addEventListener('click', () => save('confirmed'))
    saveBtn?.addEventListener('click', () => save('confirmed'))
    clearBtn?.addEventListener('click', async () => {
      if (!node.path) return
      try {
        await ctx.deleteConstellationPref(node.path)
        showToast('Asignación eliminada')
        await ctx.renderDetailPanel(await ctx.fetchNode(node.id))
      } catch (err) {
        showToast(`Error: ${(err as Error).message}`, true)
      }
    })
  }

  function renderNeighbors(nodeId: string): void {
    const graph = getCurrentGraph()
    if (!graph) { detailNeighbors.innerHTML = ''; return }

    const neighborIds = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.source === nodeId) neighborIds.add(edge.target)
      else if (edge.target === nodeId) neighborIds.add(edge.source)
    }

    const neighbors = graph.nodes.filter(n => neighborIds.has(n.id)).slice(0, 30)
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
          return `<div class="neighbor-item" data-id="${escapeAttr(n.id)}">
            <span class="neighbor-dot" style="background:${color}"></span>
            <span class="neighbor-name">${escapeHtml(short)}</span>
            <span class="neighbor-type">${escapeHtml(n.type)}</span>
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

  return {
    renderNeighbors,
    renderFolderConstellation,
    bindFolderConstellationHandlers,
  }
}