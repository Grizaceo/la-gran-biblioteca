export interface ModalField {
  label: string
  id: string
  type: 'text' | 'textarea'
  placeholder?: string
  defaultValue?: string
}

export interface ModalShellElements {
  container: HTMLElement
  title: HTMLElement
  body: HTMLElement
  closeBtn: HTMLElement
  cancelBtn: HTMLButtonElement
  confirmBtn: HTMLButtonElement
  error: HTMLElement
}

export function createModalShell(els: ModalShellElements) {
  function closeModal(): void {
    els.container.classList.remove('active')
    els.confirmBtn.style.display = ''
    setTimeout(() => {
      els.container.style.display = 'none'
    }, 300)
  }

  function showModal(
    title: string,
    fields: ModalField[],
    onConfirm: (values: Record<string, string>) => Promise<void>,
  ): void {
    els.title.textContent = title
    els.body.innerHTML = ''
    els.error.textContent = ''
    els.confirmBtn.disabled = false
    els.confirmBtn.textContent = 'Confirmar'

    const values: Record<string, string> = {}
    for (const field of fields) {
      const fieldContainer = document.createElement('div')
      fieldContainer.style.display = 'flex'
      fieldContainer.style.flexDirection = 'column'
      fieldContainer.style.gap = '6px'

      const label = document.createElement('label')
      label.textContent = field.label
      fieldContainer.appendChild(label)

      const input =
        field.type === 'textarea'
          ? document.createElement('textarea')
          : document.createElement('input')
      if (field.type === 'text') (input as HTMLInputElement).type = 'text'
      input.id = field.id
      if (field.placeholder) input.placeholder = field.placeholder
      if (field.defaultValue) input.value = field.defaultValue

      fieldContainer.appendChild(input)
      els.body.appendChild(fieldContainer)
    }

    els.container.style.display = 'flex'
    void els.container.offsetWidth
    els.container.classList.add('active')

    const closeListener = (): void => closeModal()
    const confirmListener = async (): Promise<void> => {
      els.confirmBtn.disabled = true
      els.confirmBtn.textContent = 'Procesando...'
      els.error.textContent = ''
      for (const field of fields) {
        const el = document.getElementById(field.id) as HTMLInputElement | HTMLTextAreaElement
        values[field.id] = el ? el.value : ''
      }
      try {
        await onConfirm(values)
        closeModal()
      } catch (err: unknown) {
        els.confirmBtn.disabled = false
        els.confirmBtn.textContent = 'Confirmar'
        els.error.textContent =
          err instanceof Error ? err.message : 'Ocurrió un error inesperado'
      }
    }

    els.closeBtn.onclick = closeListener
    els.cancelBtn.onclick = closeListener
    els.confirmBtn.onclick = confirmListener
  }

  els.container.addEventListener('click', (e) => {
    if (e.target === els.container) closeModal()
  })

  return { showModal, closeModal }
}
