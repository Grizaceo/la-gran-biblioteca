/** Floating "Nota" popup when the user selects text in the node preview. */

export function setupNoteCreator(
  previewEl: HTMLElement,
  onCreate: (selectedText: string) => void,
): () => void {
  let popup: HTMLDivElement | null = null

  const removePopup = () => {
    popup?.remove()
    popup = null
  }

  const onMouseUp = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!text || !sel || sel.rangeCount === 0) {
      removePopup()
      return
    }
    const range = sel.getRangeAt(0)
    if (!previewEl.contains(range.commonAncestorContainer)) {
      removePopup()
      return
    }
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      removePopup()
      return
    }

    removePopup()
    popup = document.createElement('div')
    popup.className = 'note-creator-popup'
    popup.textContent = '📝 Nota'
    popup.setAttribute('role', 'button')
    popup.tabIndex = 0
    document.body.appendChild(popup)

    const previewRect = previewEl.getBoundingClientRect()
    const left = rect.left + rect.width / 2 - previewRect.left
    const top = rect.top - previewRect.top - 36
    popup.style.position = 'absolute'
    const host = previewEl.offsetParent instanceof HTMLElement ? previewEl.offsetParent : previewEl
    if (host !== previewEl) {
      host.style.position = host.style.position || 'relative'
      host.appendChild(popup)
      const hostRect = host.getBoundingClientRect()
      popup.style.left = `${rect.left + rect.width / 2 - hostRect.left}px`
      popup.style.top = `${rect.top - hostRect.top - 36}px`
    } else {
      previewEl.style.position = previewEl.style.position || 'relative'
      previewEl.appendChild(popup)
      popup.style.left = `${left}px`
      popup.style.top = `${top}px`
      popup.style.transform = 'translateX(-50%)'
    }

    const onPopupClick = (e: MouseEvent) => {
      e.stopPropagation()
      const captured = text
      removePopup()
      sel.removeAllRanges()
      onCreate(captured)
    }
    popup.addEventListener('click', onPopupClick)
    popup.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onPopupClick(e as unknown as MouseEvent)
      }
    })
  }

  const onDocMouseDown = (e: MouseEvent) => {
    if (popup && !popup.contains(e.target as Node) && e.target !== popup) {
      removePopup()
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') removePopup()
  }

  previewEl.addEventListener('mouseup', onMouseUp)
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('keydown', onKeyDown)

  return () => {
    removePopup()
    previewEl.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('mousedown', onDocMouseDown)
    document.removeEventListener('keydown', onKeyDown)
  }
}
