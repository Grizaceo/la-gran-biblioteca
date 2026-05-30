import { createNote, updateNote, deleteNote } from '../lib/bridge'

const DEFAULT_LABELS = ['idea', 'cita', 'pregunta', 'task', 'resumen']
const LABEL_RE = /^[a-z][a-z0-9_-]{0,29}$/
const MAX_LABELS = 10

export interface NoteDraft {
  nodeId: string
  title: string
  body: string
  labels: string[]
  selectedText: string
  expanded: boolean
  editingNoteId?: string
}

export function setupNoteEditor(
  container: HTMLElement,
  sourceNodeId: string,
  sourcePath: string,
  initialSelectedText: string,
  showToast: (msg: string, isError?: boolean) => void,
  draft: NoteDraft | null,
  onDraftChange: (draft: NoteDraft | null) => void,
): void {
  container.innerHTML = ''

  let expanded = draft?.expanded ?? Boolean(initialSelectedText)
  let title = draft?.title ?? ''
  let body = draft?.body ?? ''
  let labels = new Set<string>(draft?.labels?.length ? draft.labels : ['idea'])
  let selectedText = draft?.selectedText ?? initialSelectedText
  let labelError = ''
  let editingNoteId = draft?.editingNoteId

  const persistDraft = () => {
    onDraftChange({
      nodeId: sourceNodeId,
      title,
      body,
      labels: [...labels],
      selectedText,
      expanded,
      editingNoteId,
    })
  }

  const render = () => {
    container.innerHTML = ''
    if (!expanded) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'note-editor-toggle'
      toggle.textContent = editingNoteId ? '📝 Editar nota' : '📝 Nueva nota'
      toggle.addEventListener('click', () => {
        expanded = true
        persistDraft()
        render()
      })
      container.appendChild(toggle)
      return
    }

    const form = document.createElement('div')
    form.className = 'note-editor-form'

    if (editingNoteId) {
      const editHint = document.createElement('div')
      editHint.className = 'note-edit-hint'
      editHint.textContent = `Editando nota ${editingNoteId}`
      form.appendChild(editHint)
    }

    const titleInput = document.createElement('input')
    titleInput.type = 'text'
    titleInput.className = 'note-editor-title'
    titleInput.placeholder = 'Título de la nota'
    titleInput.value = title
    titleInput.addEventListener('input', () => {
      title = titleInput.value
      persistDraft()
    })

    const labelsRow = document.createElement('div')
    labelsRow.className = 'note-labels'

    const renderLabels = () => {
      labelsRow.querySelectorAll('.note-label, .note-label-add, .note-label-add-input, .note-label-error').forEach((el) => el.remove())
      for (const name of DEFAULT_LABELS) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'note-label' + (labels.has(name) ? ' active' : '')
        chip.textContent = name
        chip.addEventListener('click', () => {
          if (labels.has(name)) labels.delete(name)
          else if (labels.size < MAX_LABELS) labels.add(name)
          persistDraft()
          renderLabels()
        })
        labelsRow.appendChild(chip)
      }
      for (const name of [...labels]) {
        if (DEFAULT_LABELS.includes(name)) continue
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'note-label active'
        chip.textContent = name
        chip.addEventListener('click', () => {
          labels.delete(name)
          persistDraft()
          renderLabels()
        })
        labelsRow.appendChild(chip)
      }
      const addBtn = document.createElement('button')
      addBtn.type = 'button'
      addBtn.className = 'note-label-add'
      addBtn.textContent = '+'
      addBtn.addEventListener('click', () => {
        const input = document.createElement('input')
        input.className = 'note-label-add-input'
        input.placeholder = 'label'
        addBtn.replaceWith(input)
        input.focus()
        const commit = () => {
          const raw = input.value.trim().toLowerCase().replace(/\s+/g, '-')
          if (!raw) {
            renderLabels()
            return
          }
          if (!LABEL_RE.test(raw)) {
            labelError = 'Solo minúsculas, números, _ y - (máx. 30)'
            renderLabels()
            return
          }
          if (labels.size >= MAX_LABELS) {
            labelError = `Máximo ${MAX_LABELS} labels`
            renderLabels()
            return
          }
          labelError = ''
          labels.add(raw)
          persistDraft()
          renderLabels()
        }
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            renderLabels()
          }
        })
        input.addEventListener('blur', commit)
      })
      labelsRow.appendChild(addBtn)
      if (labelError) {
        const err = document.createElement('span')
        err.className = 'note-label-error'
        err.textContent = labelError
        labelsRow.appendChild(err)
      }
    }
    renderLabels()

    if (selectedText.trim()) {
      const citation = document.createElement('div')
      citation.className = 'note-citation'
      citation.textContent = `"${selectedText.trim()}"`
      form.appendChild(citation)
    }

    const bodyArea = document.createElement('textarea')
    bodyArea.className = 'note-editor-body'
    bodyArea.placeholder = 'Escribe la nota en markdown…'
    bodyArea.value = body
    const autoResize = (ta: HTMLTextAreaElement) => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(320, ta.scrollHeight) + 'px'
    }
    bodyArea.addEventListener('input', () => {
      body = bodyArea.value
      persistDraft()
      autoResize(bodyArea)
    })
    requestAnimationFrame(() => autoResize(bodyArea))

    const actions = document.createElement('div')
    actions.className = 'note-editor-actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'detail-btn'
    cancelBtn.textContent = 'Cancelar'
    cancelBtn.addEventListener('click', () => {
      expanded = false
      editingNoteId = undefined
      onDraftChange(null)
      render()
    })

    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = 'detail-btn'
    saveBtn.textContent = 'Guardar ✓'
    saveBtn.addEventListener('click', async () => {
      if (!body.trim()) {
        showToast('El cuerpo de la nota no puede estar vacío', true)
        return
      }
      saveBtn.disabled = true
      try {
        if (editingNoteId) {
          await updateNote(editingNoteId, {
            title,
            body,
            labels: [...labels],
          })
          showToast('Nota actualizada')
        } else {
          const isInlineCapable = /\.(md|txt)$/i.test(sourcePath)
          await createNote({
            title,
            body,
            labels: [...labels],
            source_node_id: sourceNodeId,
            source_path: sourcePath,
            selected_text: selectedText,
            storage: isInlineCapable ? 'inline' : 'vault',
          })
          showToast('Nota guardada')
        }
        expanded = false
        title = ''
        body = ''
        labels = new Set(['idea'])
        selectedText = ''
        editingNoteId = undefined
        onDraftChange(null)
        render()
        window.dispatchEvent(new CustomEvent('lgb-notes-changed', { detail: { sourceNodeId } }))
      } catch (err) {
        showToast(`Error: ${(err as Error).message}`, true)
      } finally {
        saveBtn.disabled = false
      }
    })

    actions.append(cancelBtn, saveBtn)
    form.append(titleInput, labelsRow, bodyArea, actions)
    container.appendChild(form)
    if (!body) bodyArea.focus()
  }

  render()
}

export async function removeSavedNote(
  noteId: string,
  sourceNodeId: string,
  showToast: (msg: string, isError?: boolean) => void,
): Promise<boolean> {
  try {
    await deleteNote(noteId)
    showToast('Nota eliminada')
    window.dispatchEvent(new CustomEvent('lgb-notes-changed', { detail: { sourceNodeId } }))
    return true
  } catch (err) {
    showToast(`Error: ${(err as Error).message}`, true)
    return false
  }
}
