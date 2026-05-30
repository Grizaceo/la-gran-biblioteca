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
import { loadConstellationDetail } from '../services/constellationService'
import { PALETTE } from '../render3d/palette.js'
import { CONSTELLATION_DETAIL_SECTION } from './constellationCopy'
import { findFolderNodeId, flyCameraToNode } from './constellationFlyTo'
import type { ConstellationSettingsAPI } from './constellationSettings'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { escapeHtml } from '../lib/utils'
import { setupNoteCreator } from './noteCreator'
import { setupNoteEditor, type NoteDraft, removeSavedNote } from './noteEditor'

let hljsPromise: Promise<typeof import('highlight.js').default> | null = null

async function getHljs() {
  if (!hljsPromise) {
    hljsPromise = Promise.all([
      import('highlight.js'),
      import('highlight.js/styles/github-dark.css'),
    ]).then(([mod]) => mod.default)
  }
  return hljsPromise
}

function escapeAttr(s: string | null | undefined): string {
  return escapeHtml(s)
}

const PURIFY_HTML_OPTS = { ADD_ATTR: ['target', 'rel'] }

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

const NON_FILE_TYPES = new Set(['folder', 'workspace', 'project'])

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
  let noteCreatorCleanup: (() => void) | null = null
  let draftState: NoteDraft | null = null
  let pendingSelectedText = ''
  let previewTargetNodeId: string | null = null
  let notesListGeneration = 0
  let selectNodeInFlight: string | null = null

  async function renderSavedNotesList(sourceId: string, mount: HTMLElement): Promise<void> {
    const gen = ++notesListGeneration
    mount.innerHTML = ''
    try {
      const { notes } = await getNotesForSource(sourceId)
      if (gen !== notesListGeneration) return
      if (!notes.length) return
      const title = document.createElement('div')
      title.className = 'detail-section-title'
      title.textContent = `Notas guardadas (${notes.length})`
      mount.appendChild(title)
      const list = document.createElement('div')
      list.className = 'note-saved-list'
      for (const n of notes) {
        const row = document.createElement('div')
        row.className = 'note-saved-row'
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'note-saved-item'

        const labelText = n.title?.trim() || n.body.trim().slice(0, 60) || n.id
        const displayLabel = labelText.length > 44 ? `${labelText.slice(0, 42)}…` : labelText

        const dateStr = n.created_at
          ? new Date(n.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
          : ''

        const labelChips = (n.labels || [])
          .slice(0, 4)
          .map((l) => `<span class="note-chip">${l}</span>`)
          .join('')
        const extraLabels = (n.labels || []).length > 4 ? ` +${(n.labels || []).length - 4}` : ''

        const storageTag = n.storage === 'inline' ? '<span class="note-storage-tag">inline</span>' : ''

        item.innerHTML = `
          <div class="note-saved-header">
            <span class="note-saved-label">${displayLabel}</span>
            ${storageTag}
            <span class="note-saved-date">${dateStr}</span>
          </div>
          ${labelChips ? `<div class="note-saved-chips">${labelChips}${extraLabels ? `<span class="note-chip-more">${extraLabels}</span>` : ''}</div>` : ''}
        `
        item.title = n.body
        item.addEventListener('click', () => {
          draftState = {
            nodeId: sourceId,
            title: n.title,
            body: n.body,
            labels: n.labels?.length ? n.labels : ['idea'],
            selectedText: n.selected_text || '',
            expanded: true,
            editingNoteId: n.id,
          }
          const node = { id: sourceId, path: detailPath.textContent || '', type: detailType.textContent || 'document' } as Node
          renderNoteSection(node)
        })
        const delBtn = document.createElement('button')
        delBtn.type = 'button'
        delBtn.className = 'note-saved-delete'
        delBtn.title = 'Eliminar nota'
        delBtn.textContent = '×'
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation()
          if (!confirm('¿Eliminar esta nota?')) return
          const ok = await removeSavedNote(n.id, sourceId, showToast)
          if (ok && draftState?.editingNoteId === n.id) {
            draftState = null
          }
          void renderSavedNotesList(sourceId, mount)
        })
        row.append(item, delBtn)
        list.appendChild(row)
      }
      mount.appendChild(list)
    } catch {
      if (gen !== notesListGeneration) return
    }
  }

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
    if (savedMount) void renderSavedNotesList(id, savedMount as HTMLElement)
  })

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

  function noteIdFromNode(node: Node): string | null {
    const meta = node.metadata || {}
    const fromMeta = meta.note_id as string | undefined
    if (fromMeta) return fromMeta
    const pathName = node.path?.split(/[/\\]/).pop()?.replace(/\.md$/i, '')
    if (node.type === 'note' && pathName && /^[a-f0-9]{8}$/.test(pathName)) {
      return pathName
    }
    const m = node.id.match(/_([a-f0-9]{8})$/)
    return m ? m[1] : null
  }

  function renderNoteAnchorBar(node: Node, sourceId: string): void {
    const bar = document.createElement('div')
    bar.className = 'note-anchor-bar'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'detail-btn'
    btn.textContent = '← Ir al documento fuente'
    btn.addEventListener('click', () => selectNode(sourceId))
    bar.appendChild(btn)
    detailNotes.prepend(bar)
  }

  async function renderNoteNodePanel(node: Node): Promise<void> {
    const meta = node.metadata || {}
    const sourceId = (meta.source_node_id || meta.orbit_anchor) as string | undefined
    const noteId = noteIdFromNode(node)
    detailNotes.innerHTML = ''

    if (sourceId) {
      renderNoteAnchorBar(node, sourceId)
    }

    if (noteId && sourceId) {
      try {
        const { getNote } = await import('../lib/bridge')
        const note = await getNote(noteId)
        draftState = {
          nodeId: sourceId,
          title: note.title,
          body: note.body,
          labels: note.labels?.length ? note.labels : ['idea'],
          selectedText: note.selected_text || '',
          expanded: true,
          editingNoteId: noteId,
        }
      } catch {
        draftState = {
          nodeId: sourceId,
          title: node.label || '',
          body: '',
          labels: ['idea'],
          selectedText: '',
          expanded: true,
          editingNoteId: noteId,
        }
      }
      const editorMount = document.createElement('div')
      editorMount.className = 'note-editor-mount'
      detailNotes.appendChild(editorMount)
      const sourceNode = getCurrentGraph()?.nodes.find((n) => n.id === sourceId)
      setupNoteEditor(
        editorMount,
        sourceId,
        sourceNode?.path ?? node.path ?? '',
        draftState?.selectedText ?? '',
        showToast,
        draftState,
        (next) => { draftState = next },
      )
    }
  }

  function renderNoteSection(node: Node): void {
    if (node.type === 'note') {
      void renderNoteNodePanel(node)
      return
    }
    if (NON_FILE_TYPES.has(node.type) || !node.path) {
      detailNotes.innerHTML = ''
      return
    }
    const selectedText =
      draftState?.nodeId === node.id ? draftState.selectedText : pendingSelectedText
    pendingSelectedText = ''
    const draft = draftState?.nodeId === node.id ? draftState : null

    detailNotes.innerHTML = ''
    const savedMount = document.createElement('div')
    savedMount.className = 'note-saved-mount'
    const editorMount = document.createElement('div')
    editorMount.className = 'note-editor-mount'
    detailNotes.append(savedMount, editorMount)
    void renderSavedNotesList(node.id, savedMount)

    setupNoteEditor(
      editorMount,
      node.id,
      node.path ?? '',
      selectedText,
      showToast,
      draft,
      (next) => {
        draftState = next
      },
    )
  }

  function isPreviewStillCurrent(nodeId: string): boolean {
    return previewTargetNodeId === nodeId
  }

  async function renderPreview(node: Node): Promise<void> {
    const targetId = node.id
    previewTargetNodeId = targetId
    noteCreatorCleanup?.()
    noteCreatorCleanup = null

    if (NON_FILE_TYPES.has(node.type) || !node.path) {
      detailPreview.innerHTML = ''
      detailNotes.innerHTML = ''
      return
    }

    detailPreview.innerHTML = '<div class="preview-loading">Cargando vista previa…</div>'

    try {
      const result = await fetchNodeContent(node.id)
      if (!isPreviewStillCurrent(targetId)) return
      const { content, lang, truncated } = result

      let html = ''
      if (lang === 'markdown') {
        html = DOMPurify.sanitize(
          await Promise.resolve(marked.parse(content)),
          PURIFY_HTML_OPTS,
        )
      } else {
        const hljs = await getHljs()
        const highlighted = lang
          ? hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(content).value
        html = DOMPurify.sanitize(`<pre class="hljs"><code>${highlighted}</code></pre>`)
      }

      const truncNote = truncated
        ? '<div class="preview-truncated">Vista previa truncada a 2 MB — usa "Abrir" para ver el archivo completo.</div>'
        : ''

      detailPreview.innerHTML = `
        <div class="detail-section-title">Vista previa</div>
        ${truncNote}
        <div class="preview-content markdown-body">${html}</div>`
      applyExternalLinks(detailPreview)
      noteCreatorCleanup = setupNoteCreator(detailPreview, (selectedText) => {
        pendingSelectedText = selectedText
        if (draftState?.nodeId !== node.id) {
          draftState = {
            nodeId: node.id,
            title: '',
            body: '',
            labels: ['idea'],
            selectedText,
            expanded: true,
          }
        } else {
          draftState = { ...draftState, selectedText, expanded: true }
        }
        renderNoteSection(node)
      })
      renderNoteSection(node)
    } catch (err: unknown) {
      if (!isPreviewStillCurrent(targetId)) return
      const status = err instanceof Error ? err.message : String(err)
      if (status === '415') {
        detailPreview.innerHTML = '<div class="preview-unavailable">Vista previa no disponible para este tipo · usa "Abrir".</div>'
      } else if (status === '403') {
        detailPreview.innerHTML = ''
      } else {
        detailPreview.innerHTML = '<div class="preview-unavailable">No se pudo cargar la vista previa.</div>'
      }
      renderNoteSection(node)
    }
  }

  let catalogCache: Array<{ id: string; name: string; name_es?: string }> | null = null

  async function getCatalog() {
    if (!catalogCache) {
      const data = await fetchConstellationCatalog()
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
      const { prefs } = await fetchConstellationPrefs()
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
        await saveConstellationPref(node.path, select.value, status)
        if (status === 'confirmed') {
          constellationSettings?.notifyConfirmedWithoutLayout()
        }
        showToast('Constelación guardada')
        await renderDetailPanel(await fetchNode(node.id))
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
        await deleteConstellationPref(node.path)
        showToast('Asignación eliminada')
        await renderDetailPanel(await fetchNode(node.id))
      } catch (err) {
        showToast(`Error: ${(err as Error).message}`, true)
      }
    })
  }

  async function renderActions(node: Node): Promise<void> {
    if (!node.path) { detailActions.innerHTML = ''; return }

    if (node.type === 'folder') {
      const constellationHtml = await renderFolderConstellation(node)
      detailActions.innerHTML = `${constellationHtml}
        <button class="detail-btn" id="btn-open-folder">Abrir carpeta</button>`
      document.getElementById('btn-open-folder')!.addEventListener('click', async () => {
        try {
          await openNode(node.id, false)
        } catch (err) {
          showToast(`No se pudo abrir la carpeta: ${(err as Error).message}`, true)
        }
      })
      bindFolderConstellationHandlers(node)
      return
    }

    if (NON_FILE_TYPES.has(node.type)) { detailActions.innerHTML = ''; return }

    detailActions.innerHTML = `
      <button class="detail-btn" id="btn-open-file">Abrir</button>
      <button class="detail-btn" id="btn-reveal-file">Revelar</button>`

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
  }

  async function renderDetailPanel(node: Node): Promise<void> {
    const color = (PALETTE as Record<string, string>)[node.type] ?? (PALETTE as Record<string, string>).default
    detailName.textContent      = node.label
    detailType.textContent      = node.type
    ;(detailType as HTMLElement).style.background = color
    detailPath.textContent      = node.path ?? ''

    const meta = node.metadata ?? {}
    const backlinks = Array.isArray(meta.backlinks) ? meta.backlinks as Array<{ id: string; label?: string }> : []
    const metaRows = Object.entries(meta)
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
        selectNode(id)
      })
    })

    await renderActions(node)
    renderNeighbors(node.id)

    if (NON_FILE_TYPES.has(node.type) || !node.path) {
      detailNotes.innerHTML = ''
      noteCreatorCleanup?.()
      noteCreatorCleanup = null
    } else if (node.type === 'note') {
      noteCreatorCleanup?.()
      noteCreatorCleanup = null
      void renderNoteNodePanel(node)
    } else {
      if (draftState?.nodeId !== node.id) {
        draftState = null
      }
      renderNoteSection(node)
    }

    detailPanel.classList.add('active')
    container.style.right = 'var(--detail-panel-width, 480px)'
    setTimeout(() => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
      engine.fg.refresh?.()
    }, 50)
    engine.pause()

    renderPreview(node).catch(() => {})
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
    refreshNeighbors: renderNeighbors,
    getCurrentNodeId: () => currentNodeId,
    closePanel,
  }
}
