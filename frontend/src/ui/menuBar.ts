import { Graph3DEngine } from '../render3d/Graph3DEngine'
import * as bridge from '../lib/bridge'

export function initMenuBar(engine: Graph3DEngine): void {
  // --- DOM References ---
  const menuBar = document.getElementById('menu-bar')
  const modalContainer = document.getElementById('modal-container') as HTMLElement
  const modalContent = document.getElementById('modal-content') as HTMLElement
  const modalTitle = document.getElementById('modal-title') as HTMLElement
  const modalBody = document.getElementById('modal-body') as HTMLElement
  const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLElement
  const modalCancelBtn = document.getElementById('modal-cancel-btn') as HTMLButtonElement
  const modalConfirmBtn = document.getElementById('modal-confirm-btn') as HTMLButtonElement
  const modalError = document.getElementById('modal-error') as HTMLElement

  const toast = document.getElementById('notif-toast') as HTMLElement
  const toastText = document.getElementById('notif-text') as HTMLElement

  if (!menuBar || !modalContainer || !toast) {
    console.error('[LGB menuBar] Essential DOM elements missing')
    return
  }

  // --- Premium Notification System ---
  let toastTimeout: number | null = null
  function showNotification(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    if (toastTimeout) {
      clearTimeout(toastTimeout)
    }

    toast.className = '' // reset classes
    void toast.offsetWidth // trigger reflow
    
    toast.classList.add('active', type)
    toastText.textContent = message

    toastTimeout = window.setTimeout(() => {
      toast.classList.remove('active')
    }, 4000)
  }

  // --- Dropdown Menu Click Handlers ---
  const menuItems = menuBar.querySelectorAll('.menu-item')

  menuItems.forEach((item) => {
    const trigger = item.querySelector('.menu-trigger') as HTMLElement
    
    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      
      // If it's a direct action button like Licences, don't toggle dropdown
      const action = trigger.getAttribute('data-action')
      if (action) {
        handleMenuAction(action)
        closeAllMenus()
        return
      }

      const isActive = item.classList.contains('active')
      closeAllMenus()
      
      if (!isActive) {
        item.classList.add('active')
      }
    })
  })

  // Close menus when clicking outside
  document.addEventListener('click', () => {
    closeAllMenus()
  })

  function closeAllMenus(): void {
    menuItems.forEach((item) => {
      item.classList.remove('active')
    })
  }

  // --- Menu Action Router ---
  function handleMenuAction(action: string): void {
    switch (action) {
      // File actions
      case 'create-file':
        openCreateFileModal()
        break
      case 'create-folder':
        openCreateFolderModal()
        break
      case 'import-github':
        openImportGithubModal()
        break
      case 'import-arxiv':
        openImportArxivModal()
        break
      case 'import-pubmed':
        openImportPubmedModal()
        break

      // View actions
      case 'reset-camera':
        engine.fg.cameraPosition({ x: 0, y: 0, z: 400 }, null, 1000)
        showNotification('Vista de cámara reestablecida', 'info')
        break
      case 'toggle-starfield':
        toggleStarfieldRotation()
        break
      case 'toggle-photons':
        togglePhotonsAnimation()
        break

      // Licences action
      case 'show-licences':
        openLicencesModal()
        break
      
      default:
        console.warn(`[LGB menuBar] Unknown action: ${action}`)
    }
  }

  // Hook options click inside dropdowns
  const options = menuBar.querySelectorAll('.menu-option')
  options.forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation()
      const action = opt.getAttribute('data-action')
      if (action) {
        handleMenuAction(action)
      }
      closeAllMenus()
    })
  })

  // --- View Control Functions ---
  function toggleStarfieldRotation(): void {
    const isEnabled = !engine.starfieldRotationEnabled
    engine.starfieldRotationEnabled = isEnabled
    
    const optEl = document.getElementById('menu-opt-starfield')
    if (optEl) {
      optEl.textContent = `Girar Starfield (${isEnabled ? 'ON' : 'OFF'})`
    }
    showNotification(
      `Rotación de Starfield: ${isEnabled ? 'Activada' : 'Pausada'}`,
      'info'
    )
  }

  function togglePhotonsAnimation(): void {
    const isEnabled = !engine.photonsEnabled
    engine.setPhotonsEnabled(isEnabled)
    
    const optEl = document.getElementById('menu-opt-photons')
    if (optEl) {
      optEl.textContent = `Fotones Activos (${isEnabled ? 'ON' : 'OFF'})`
    }
    showNotification(
      `Flujo de fotones animados: ${isEnabled ? 'Activado' : 'Desactivado'}`,
      'info'
    )
  }

  // --- Reusable Modal Dialog Manager ---
  interface ModalField {
    label: string
    id: string
    type: 'text' | 'textarea'
    placeholder?: string
    defaultValue?: string
  }

  function showModal(
    title: string,
    fields: ModalField[],
    onConfirm: (values: Record<string, string>) => Promise<void>
  ): void {
    modalTitle.textContent = title
    modalBody.innerHTML = ''
    modalError.textContent = ''
    modalConfirmBtn.disabled = false
    modalConfirmBtn.textContent = 'Confirmar'

    // Build form fields programmatically
    const values: Record<string, string> = {}
    
    fields.forEach((field) => {
      const fieldContainer = document.createElement('div')
      fieldContainer.style.display = 'flex'
      fieldContainer.style.flexDirection = 'column'
      fieldContainer.style.gap = '6px'

      const label = document.createElement('label')
      label.textContent = field.label
      fieldContainer.appendChild(label)

      let input: HTMLInputElement | HTMLTextAreaElement
      if (field.type === 'textarea') {
        input = document.createElement('textarea')
      } else {
        input = document.createElement('input')
        input.type = 'text'
      }

      input.id = field.id
      if (field.placeholder) {
        input.placeholder = field.placeholder
      }
      if (field.defaultValue) {
        input.value = field.defaultValue
      }

      fieldContainer.appendChild(input)
      modalBody.appendChild(fieldContainer)
    })

    // Show modal overlay
    modalContainer.style.display = 'flex'
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')

    // Clean listeners and bind new ones
    const closeListener = (): void => closeModal()
    const confirmListener = async (): Promise<void> => {
      modalConfirmBtn.disabled = true
      modalConfirmBtn.textContent = 'Procesando...'
      modalError.textContent = ''

      // Gather input values
      fields.forEach((field) => {
        const el = document.getElementById(field.id) as HTMLInputElement | HTMLTextAreaElement
        values[field.id] = el ? el.value : ''
      })

      try {
        await onConfirm(values)
        closeModal()
      } catch (err: any) {
        modalConfirmBtn.disabled = false
        modalConfirmBtn.textContent = 'Confirmar'
        modalError.textContent = err.message || 'Ocurrió un error inesperado'
      }
    }

    // Assign temporary listeners
    modalCloseBtn.onclick = closeListener
    modalCancelBtn.onclick = closeListener
    modalConfirmBtn.onclick = confirmListener
  }

  function closeModal(): void {
    modalContainer.classList.remove('active')
    setTimeout(() => {
      modalContainer.style.display = 'none'
    }, 300)
  }

  // Close modal when clicking on overlay background
  modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) {
      closeModal()
    }
  })

  // --- Specific Modal Handlers ---

  function openCreateFileModal(): void {
    showModal(
      'Nuevo Archivo',
      [
        {
          label: 'Ruta relativa (ej: notas/mi_nota.md)',
          id: 'path',
          type: 'text',
          placeholder: 'Ruta dentro del workspace...'
        },
        {
          label: 'Contenido Inicial (opcional)',
          id: 'content',
          type: 'textarea',
          placeholder: 'Escribe tu contenido Markdown aquí...'
        }
      ],
      async (values) => {
        const path = values.path.trim()
        if (!path) throw new Error('La ruta del archivo es obligatoria')
        const res = await bridge.createFile(path, values.content)
        showNotification(`Archivo creado con éxito: ${res.path}`, 'success')
      }
    )
  }

  function openCreateFolderModal(): void {
    showModal(
      'Nueva Carpeta',
      [
        {
          label: 'Ruta de la carpeta (ej: notas/referencias)',
          id: 'path',
          type: 'text',
          placeholder: 'Ruta dentro del workspace...'
        }
      ],
      async (values) => {
        const path = values.path.trim()
        if (!path) throw new Error('La ruta de la carpeta es obligatoria')
        const res = await bridge.createFolder(path)
        showNotification(`Carpeta creada con éxito: ${res.path}`, 'success')
      }
    )
  }

  function openImportGithubModal(): void {
    showModal(
      'Importar Repositorio GitHub',
      [
        {
          label: 'Repositorio Público (ej: owner/repo o URL)',
          id: 'url',
          type: 'text',
          placeholder: 'https://github.com/usuario/repositorio...'
        }
      ],
      async (values) => {
        const url = values.url.trim()
        if (!url) throw new Error('El repositorio es obligatorio')
        showNotification('Iniciando descarga de GitHub...', 'info')
        const res = await bridge.importGithub(url)
        showNotification(`Repositorio importado con éxito en: ${res.path}`, 'success')
      }
    )
  }

  function openImportArxivModal(): void {
    showModal(
      'Importar de arXiv',
      [
        {
          label: 'ID de arXiv o URL (ej: 2303.08774)',
          id: 'arxivId',
          type: 'text',
          placeholder: 'Identificador del paper en arXiv...'
        }
      ],
      async (values) => {
        const arxivId = values.arxivId.trim()
        if (!arxivId) throw new Error('El identificador de arXiv es obligatorio')
        showNotification('Consultando arXiv API...', 'info')
        const res = await bridge.importArxiv(arxivId)
        showNotification(`Paper importado como Markdown en: ${res.path}`, 'success')
      }
    )
  }

  function openImportPubmedModal(): void {
    showModal(
      'Importar de PubMed',
      [
        {
          label: 'PMID de PubMed o URL (ej: 36915867)',
          id: 'pmid',
          type: 'text',
          placeholder: 'Identificador del artículo en PubMed...'
        }
      ],
      async (values) => {
        const pmid = values.pmid.trim()
        if (!pmid) throw new Error('El PMID de PubMed es obligatorio')
        showNotification('Consultando PubMed API...', 'info')
        const res = await bridge.importPubmed(pmid)
        showNotification(`Artículo importado como Markdown en: ${res.path}`, 'success')
      }
    )
  }

  function openLicencesModal(): void {
    modalTitle.textContent = 'Licencias del Proyecto'
    modalConfirmBtn.disabled = false
    modalConfirmBtn.textContent = 'Cerrar'
    modalConfirmBtn.onclick = () => closeModal()
    modalCancelBtn.style.display = 'none' // hide cancel button for licences modal
    modalError.textContent = ''

    // Render elegant credits lists inside modal body
    modalBody.innerHTML = `
      <div style="color: rgba(255,255,255,0.8); display:flex; flex-direction:column; gap:14px; font-family:'Helvetica Neue', Arial, sans-serif; font-size:12px; line-height:1.6; max-height: 350px; overflow-y: auto; padding-right:6px;">
        <p><strong>La Gran Biblioteca</strong> se construye sobre tecnologías de código abierto de última generación:</p>
        
        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">Three.js</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Motor de renderizado 3D acelerado por GPU.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>

        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">3D Force Graph</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Visualización de grafos tridimensionales con fuerzas físicas.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>

        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">Marked</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Compilador rápido de Markdown para previsualización.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>

        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">Highlight.js</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Resaltado de sintaxis sintáctico en múltiples lenguajes.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia BSD-3</span>
        </div>

        <div>
          <h4 style="color:#4fc3f7; font-size:13px; font-weight:500; margin-bottom:2px;">FastAPI & Python</h4>
          <p style="color:rgba(255,255,255,0.5); font-size:11px;">Backend de alta velocidad, indexador de SQLite y observador de archivos.</p>
          <span style="background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:3px; font-size:9px; color:rgba(255,255,255,0.6);">Licencia MIT</span>
        </div>
      </div>
    `

    modalContainer.style.display = 'flex'
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')

    // Clean display cancel button state when closing
    modalCloseBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
    modalConfirmBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
  }
}
