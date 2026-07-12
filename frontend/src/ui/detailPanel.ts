import type { Node, Graph } from '../lib/bridge'
import {
  fetchNodeContent,
  openNode,
  studyNode,
  fetchNode,
  getNotesForSource,
  fetchConstellationPrefs,
  fetchConstellationCatalog,
  saveConstellationPref,
  deleteConstellationPref,
} from '../lib/bridge'
import { PALETTE } from '../render3d/palette.js'
import type { ConstellationSettingsAPI } from './constellationSettings'
import { escapeHtml } from '../lib/utils'
import { setupNoteCreator } from './noteCreator'
import { setupNoteEditor } from './noteEditor'
import { setupFileEditor, isFileEditable, type FileEditorAPI } from './fileEditor'
import { setupDetailNotes } from './detailNotes'
import { setupDetailMeta } from './detailMeta'

function escapeAttr(s: string | null | undefined): string {
  return escapeHtml(s)
}

const NON_FILE_TYPES = new Set(['folder', 'workspace', 'project'])

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/** Open PubMed/arXiv and other http(s) links in a new tab, not the LGB shell. */
function applyExternalLinks(root: ParentNode): void {
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const a = anchor as HTMLAnchorElement
    const href = a.getAttribute('href') || ''
    if (!isExternalHref(href)) return
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  })
}

function formatMetaValue(key: string, value: unknown): string {
  const text = String(value)
  if (key === 'url' || /^https?:\/\//i.test(text)) {
    const href = escapeAttr(text)
    return `<a class="detail-external-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`
  }
  return escapeHtml(text)
}

interface Engine {
  fg: {
    graphData(): { nodes: Array<Record<string, unknown>> }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cameraPosition(to: { x: number; y: number; z: number }, lookAt?: { x: number; y: number; z: number }, duration?: number): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    width(w: number): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    height(h: number): any
    refresh?(): void
  }
  pause(): void
  resume(): void
}

export interface DetailPanelAPI {
  selectNode(nodeId: string, waitForCameraMs?: number): Promise<void>
  refreshNeighbors(nodeId: string): void
  getCurrentNodeId(): string | null
  closePanel: () => void
}

export function setupDetailPanel(
  container: HTMLElement,
  engine: Engine,
  getCurrentGraph: () => Graph | null,
  showToast: (msg: string, isError?: boolean) => void,
  constellationSettings?: ConstellationSettingsAPI,
): DetailPanelAPI {
  const detailPanel     = document.getElementById('node-detail')!
  const detailName      = document.getElementById('node-detail-name')!
  const detailType      = document.getElementById('node-detail-type')!
  const detailPath      = document.getElementById('node-detail-path')!
  const detailMeta      = document.getElementById('node-detail-meta')!
  const detailClose     = document.getElementById('node-detail-close')!
  const detailActions   = document.getElementById('node-detail-actions')!
  const detailPreview   = document.getElementById('node-detail-preview')!
  const detailNotes     = document.getElementById('node-detail-notes')!
  const detailNeighbors = document.getElementById('node-detail-neighbors')!

  let currentNodeId: string | null = null
  let selectNodeInFlight: string | null = null
  const fileEditor: FileEditorAPI = setupFileEditor(showToast)

  // --- Sub-module: notes + preview ---
  const notes = setupDetailNotes({
    detailNotes,
    detailPreview,
    detailPath,
    detailType,
    getCurrentGraph,
    showToast,
    selectNode: (id: string) => { void selectNode(id) },
    fetchNodeContent,
    getNotesForSource,
    setupNoteCreator,
    setupNoteEditor,
  })

  // --- Sub-module: neighbors + constellation ---
  const meta = setupDetailMeta({
    detailNeighbors,
    detailMeta,
    getCurrentGraph,
    showToast,
    selectNode: (id: string) => { void selectNode(id) },
    constellationSettings,
    fetchNode,
    fetchConstellationPrefs,
    fetchConstellationCatalog,
    saveConstellationPref,
    deleteConstellationPref,
    engine: { fg: engine.fg },
    renderDetailPanel: (node: Node) => renderDetailPanel(node),
  })

  function closePanel(): void {
    detailPanel.classList.remove('active')
    container.style.right = '0'
    engine.resume()
    setTimeout(() => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
      engine.fg.refresh?.()
    }, 320)
    currentNodeId = null
  }

  detailClose.addEventListener('click', closePanel)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailPanel.classList.contains('active')) closePanel()
  })
  window.addEventListener('lgb-notes-changed', () => {
    const id = currentNodeId
    if (!id) return
    const savedMount = detailNotes.querySelector('.note-saved-mount')
    if (savedMount) {
      // Re-trigger note section render which calls renderSavedNotesList internally
      const graph = getCurrentGraph()
      const node = graph?.nodes.find(n => n.id === id)
      if (node) notes.renderNoteSection(node)
    }
  })

  async function renderActions(node: Node): Promise<void> {
    if (!node.path) { detailActions.innerHTML = ''; return }

    if (node.type === 'folder') {
      const constellationHtml = await meta.renderFolderConstellation(node)
      detailActions.innerHTML = `${constellationHtml}
        <button class="detail-btn" id="btn-open-folder">Abrir carpeta</button>`
      document.getElementById('btn-open-folder')!.addEventListener('click', async () => {
        try {
          await openNode(node.id, false)
        } catch (err) {
          showToast(`No se pudo abrir la carpeta: ${(err as Error).message}`, true)
        }
      })
      meta.bindFolderConstellationHandlers(node)
      return
    }

    if (NON_FILE_TYPES.has(node.type)) { detailActions.innerHTML = ''; return }

    const canEdit = isFileEditable(node)
    detailActions.innerHTML = `
      <button class="detail-btn" id="btn-open-file">Abrir</button>
      <button class="detail-btn" id="btn-reveal-file">Revelar</button>
      ${canEdit ? '<button class="detail-btn" id="btn-edit-file">Editar</button>' : ''}`

    document.getElementById('btn-open-file')!.addEventListener('click', async () => {
      try {
        await openNode(node.id, false)
      } catch (err) {
        showToast(`No se pudo abrir: ${(err as Error).message}`, true)
      }
    })

    document.getElementById('btn-reveal-file')!.addEventListener('click', async () => {
      try {
        await openNode(node.id, true)
      } catch (err) {
        showToast(`No se pudo revelar: ${(err as Error).message}`, true)
      }
    })

    const editBtn = document.getElementById('btn-edit-file')
    if (editBtn) {
      editBtn.addEventListener('click', () => fileEditor.open(node))
    }
  }

  async function renderDetailPanel(node: Node): Promise<void> {
    const color = (PALETTE as Record<string, string>)[node.type] ?? (PALETTE as Record<string, string>).default
    detailName.textContent      = node.label
    detailType.textContent      = node.type
    ;(detailType as HTMLElement).style.background = color
    detailPath.textContent      = node.path ?? ''

    const nodeMeta = node.metadata ?? {}
    const backlinks = Array.isArray(nodeMeta.backlinks) ? nodeMeta.backlinks as Array<{ id: string; label?: string }> : []
    const metaRows = Object.entries(nodeMeta)
      .filter(([k, v]) => k !== 'backlinks' && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<div class="detail-meta-row"><span>${escapeHtml(k)}</span><span>${formatMetaValue(k, v)}</span></div>`)
      .join('')

    let backlinksHtml = ''
    if (backlinks.length) {
      backlinksHtml = `
        <div class="detail-section-title">Backlinks (${backlinks.length})</div>
        <div class="neighbor-list">
          ${backlinks.slice(0, 25).map(bl => {
            const name = bl.label || bl.id
            const short = name.length > 36 ? name.slice(0, 34) + '…' : name
            return `<div class="neighbor-item" data-id="${escapeAttr(bl.id)}">
              <span class="neighbor-dot" style="background:#81c784"></span>
              <span class="neighbor-name">${escapeHtml(short)}</span>
            </div>`
          }).join('')}
        </div>`
    }

    detailMeta.innerHTML = (metaRows || '<div class="detail-meta-row"><span style="opacity:.4">sin metadatos</span></div>') + backlinksHtml
    applyExternalLinks(detailMeta)
    detailMeta.querySelectorAll('.neighbor-item[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id!
        void selectNode(id)
      })
    })

    await renderActions(node)
    meta.renderNeighbors(node.id)

    if (NON_FILE_TYPES.has(node.type) || !node.path) {
      detailNotes.innerHTML = ''
      notes.cleanup()
    } else if (node.type === 'note') {
      notes.cleanup()
      void notes.renderNoteNodePanel(node)
    } else {
      notes.renderNoteSection(node)
    }

    detailPanel.classList.add('active')
    container.style.right = 'var(--detail-panel-width, 480px)'
    setTimeout(() => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
      engine.fg.refresh?.()
    }, 50)
    engine.pause()

    notes.renderPreview(node).catch(() => {})
  }

  async function selectNode(nodeId: string, waitForCameraMs = 0): Promise<void> {
    if (selectNodeInFlight === nodeId) return
    selectNodeInFlight = nodeId
    const CAMERA_ANIM_MS = 800
    const t0 = Date.now()

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
        CAMERA_ANIM_MS,
      )
    }

    try {
      await studyNode(nodeId)
      const detail = await fetchNode(nodeId)
      currentNodeId = nodeId

      // When called from autofocus, wait for the camera animation to finish
      // before opening the panel so the user can see the graph navigate to the node.
      if (waitForCameraMs > 0) {
        const elapsed = Date.now() - t0
        const remaining = Math.max(0, waitForCameraMs - elapsed)
        if (remaining > 0) await new Promise<void>(r => setTimeout(r, remaining))
      }

      await renderDetailPanel(detail)
    } catch (err) {
      console.warn('[LGB] selectNode failed:', err)
    } finally {
      if (selectNodeInFlight === nodeId) selectNodeInFlight = null
    }
  }

  return {
    selectNode,
    refreshNeighbors: meta.renderNeighbors,
    getCurrentNodeId: () => currentNodeId,
    closePanel,
  }
}