import type { Node, Graph } from '../lib/bridge'
import { fetchNodeContent, getNotesForSource } from '../lib/bridge'
import { setupNoteCreator } from './noteCreator'
import { setupNoteEditor, removeSavedNote, type NoteDraft } from './noteEditor'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { escapeHtml } from '../lib/utils'

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

export interface NotesContext {
  detailNotes: HTMLElement
  detailPreview: HTMLElement
  detailPath: HTMLElement
  detailType: HTMLElement
  getCurrentGraph: () => Graph | null
  showToast: (msg: string, isError?: boolean) => void
  selectNode: (id: string) => void
  fetchNodeContent: typeof fetchNodeContent
  getNotesForSource: typeof getNotesForSource
  setupNoteCreator: typeof setupNoteCreator
  setupNoteEditor: typeof setupNoteEditor
}

export function setupDetailNotes(ctx: NotesContext): {
  renderPreview: (node: Node) => Promise<void>
  renderNoteSection: (node: Node) => void
  renderNoteNodePanel: (node: Node) => Promise<void>
  cleanup: () => void
} {
  const { detailNotes, detailPreview, detailPath, detailType, getCurrentGraph, showToast, selectNode } = ctx

  let noteCreatorCleanup: (() => void) | null = null
  let draftState: NoteDraft | null = null
  let pendingSelectedText = ''
  let previewTargetNodeId: string | null = null
  let notesListGeneration = 0

  async function renderSavedNotesList(sourceId: string, mount: HTMLElement): Promise<void> {
    const gen = ++notesListGeneration
    mount.innerHTML = ''
    try {
      const { notes } = await ctx.getNotesForSource(sourceId)
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
      ctx.setupNoteEditor(
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

    ctx.setupNoteEditor(
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
      const result = await ctx.fetchNodeContent(node.id)
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
      noteCreatorCleanup = ctx.setupNoteCreator(detailPreview, (selectedText) => {
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

  function cleanup(): void {
    noteCreatorCleanup?.()
    noteCreatorCleanup = null
    draftState = null
    pendingSelectedText = ''
    previewTargetNodeId = null
  }

  return {
    renderPreview,
    renderNoteSection,
    renderNoteNodePanel,
    cleanup,
  }
}