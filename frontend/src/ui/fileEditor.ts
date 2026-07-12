/**
 * fileEditor.ts — In-app file editor for La Gran Biblioteca.
 *
 * Opens a modal overlay with a textarea + markdown preview toggle.
 * Saves via PUT /api/node/{id}/content. Only text files (TEXT_EXTENSIONS).
 */

import { fetchNodeContent, updateNodeContent } from '../lib/api/nodes'
import type { Node } from '../lib/api/types'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const EDITABLE_EXTS = new Set([
  'md', 'txt', 'rst', 'py', 'js', 'ts', 'jsx', 'tsx', 'json',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'sh', 'bash', 'zsh',
  'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'java', 'rb', 'php',
  'cs', 'swift', 'kt', 'r', 'sql', 'css', 'scss', 'html', 'xml',
  'dockerfile',
])

export function isFileEditable(node: Node): boolean {
  if (!node.path) return false
  const name = node.path.split(/[/\\]/).pop() || ''
  const ext = name.toLowerCase() === 'dockerfile' ? 'dockerfile' : name.split('.').pop()?.toLowerCase() || ''
  return EDITABLE_EXTS.has(ext)
}

export interface FileEditorAPI {
  open: (node: Node) => void
  close: () => void
}

export function setupFileEditor(
  showToast: (msg: string, isError?: boolean) => void,
): FileEditorAPI {
  // Modal container — reuse the existing modal infrastructure
  let modalEl: HTMLElement | null = null
  let textarea: HTMLTextAreaElement | null = null
  let currentNode: Node | null = null
  let isDirty = false
  let isPreview = false

  function close(): void {
    if (modalEl) {
      modalEl.classList.remove('active')
      setTimeout(() => modalEl?.remove(), 300)
      modalEl = null
    }
    textarea = null
    currentNode = null
    isDirty = false
    isPreview = false
  }

  function buildModal(): HTMLElement {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay file-editor-overlay'
    overlay.setAttribute('aria-hidden', 'false')

    overlay.innerHTML = `
      <div class="modal-content file-editor-content" role="dialog" aria-modal="true" aria-labelledby="file-editor-title">
        <div class="modal-header">
          <h3 id="file-editor-title">Editar archivo</h3>
          <button class="modal-close" id="file-editor-close">&times;</button>
        </div>
        <div class="modal-body file-editor-body">
          <div class="file-editor-toolbar">
            <span id="file-editor-path" class="file-editor-path"></span>
            <div class="file-editor-toggles">
              <button type="button" class="detail-btn" id="file-editor-toggle-preview">Vista previa</button>
              <span id="file-editor-dirty" class="file-editor-dirty" style="display:none">● sin guardar</span>
            </div>
          </div>
          <div class="file-editor-wrap">
            <textarea id="file-editor-textarea" class="file-editor-textarea" spellcheck="false" autocomplete="off"></textarea>
            <div id="file-editor-preview" class="file-editor-preview" style="display:none"></div>
          </div>
        </div>
        <div class="modal-footer">
          <span class="modal-error" id="file-editor-error"></span>
          <button class="btn-cancel" id="file-editor-cancel">Cancelar</button>
          <button class="btn-confirm" id="file-editor-save">Guardar</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    // Make visible: CSS uses .modal-overlay { display: none } → .active { display: flex }
    void overlay.offsetWidth // trigger reflow for transition
    overlay.classList.add('active')

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close()
    })

    overlay.querySelector('#file-editor-close')!.addEventListener('click', close)
    overlay.querySelector('#file-editor-cancel')!.addEventListener('click', () => {
      if (isDirty && !confirm('Hay cambios sin guardar. ¿Cerrar de todas formas?')) return
      close()
    })

    overlay.querySelector('#file-editor-save')!.addEventListener('click', save)
    overlay.querySelector('#file-editor-toggle-preview')!.addEventListener('click', togglePreview)

    // Keyboard: Ctrl+S to save, Esc to close
    overlay.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
      if (e.key === 'Escape' && !isDirty) {
        close()
      }
    })

    return overlay
  }

  async function save(): Promise<void> {
    if (!currentNode || !textarea) return
    const saveBtn = modalEl?.querySelector('#file-editor-save') as HTMLButtonElement
    const errEl = modalEl?.querySelector('#file-editor-error') as HTMLElement
    if (saveBtn) saveBtn.disabled = true
    if (errEl) errEl.textContent = ''

    try {
      await updateNodeContent(currentNode.id, textarea.value)
      isDirty = false
      updateDirtyIndicator()
      showToast('Archivo guardado')
      close()
    } catch (err) {
      if (errEl) errEl.textContent = (err as Error).message
      showToast(`Error: ${(err as Error).message}`, true)
    } finally {
      if (saveBtn) saveBtn.disabled = false
    }
  }

  function togglePreview(): void {
    if (!textarea || !modalEl) return
    const previewEl = modalEl.querySelector('#file-editor-preview') as HTMLElement
    const toggleBtn = modalEl.querySelector('#file-editor-toggle-preview') as HTMLButtonElement

    isPreview = !isPreview
    if (isPreview) {
      // Render markdown
      const raw = textarea.value
      const isMd = currentNode?.path?.endsWith('.md') || currentNode?.path?.endsWith('.txt')
      if (isMd) {
        const html = DOMPurify.sanitize(marked.parse(raw, { async: false }) as string)
        previewEl.innerHTML = html
      } else {
        previewEl.innerHTML = `<pre class="file-editor-pre">${escapeHtml(raw)}</pre>`
      }
      previewEl.style.display = 'block'
      textarea.style.display = 'none'
      toggleBtn.textContent = 'Editar'
    } else {
      previewEl.style.display = 'none'
      textarea.style.display = 'block'
      toggleBtn.textContent = 'Vista previa'
      textarea.focus()
    }
  }

  function updateDirtyIndicator(): void {
    const dirtyEl = modalEl?.querySelector('#file-editor-dirty') as HTMLElement
    if (dirtyEl) dirtyEl.style.display = isDirty ? 'inline' : 'none'
  }

  async function open(node: Node): Promise<void> {
    if (!isFileEditable(node)) {
      showToast('Este tipo de archivo no es editable', true)
      return
    }

    close() // close any previous
    currentNode = node
    modalEl = buildModal()

    const pathEl = modalEl.querySelector('#file-editor-path') as HTMLElement
    pathEl.textContent = node.path

    textarea = modalEl.querySelector('#file-editor-textarea') as HTMLTextAreaElement
    textarea.value = 'Cargando…'
    textarea.disabled = true

    try {
      const content = await fetchNodeContent(node.id)
      textarea.value = content.content
      textarea.disabled = false
      isDirty = false
      updateDirtyIndicator()

      // Track changes
      textarea.addEventListener('input', () => {
        isDirty = true
        updateDirtyIndicator()
      })

      textarea.focus()
    } catch (err) {
      textarea.value = ''
      const errEl = modalEl.querySelector('#file-editor-error') as HTMLElement
      if (errEl) errEl.textContent = `Error al cargar: ${(err as Error).message}`
      showToast(`Error al cargar: ${(err as Error).message}`, true)
    }
  }

  return { open, close }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}