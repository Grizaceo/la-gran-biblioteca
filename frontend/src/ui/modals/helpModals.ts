import { HELP_GUIDE_HTML, mountHelpGuideStyles } from '../helpGuide'
import type { ModalContext } from './importModals'

export function setupHelpModals(ctx: ModalContext): {
  openHelpGuideModal: () => void
  openLicencesModal: () => void
} {
  const {
    closeModal,
    modalTitle,
    modalBody,
    modalError,
    modalContainer,
    modalConfirmBtn,
    modalCancelBtn,
    modalCloseBtn,
  } = ctx

  function openHelpGuideModal(): void {
    mountHelpGuideStyles()
    modalTitle.textContent = 'Ayuda — navegar La Gran Biblioteca'
    modalConfirmBtn.disabled = false
    modalConfirmBtn.textContent = 'Cerrar'
    modalCancelBtn.style.display = 'none'
    modalError.textContent = ''
    modalBody.innerHTML = HELP_GUIDE_HTML

    modalContainer.style.display = 'flex'
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')

    modalCloseBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
    modalConfirmBtn.onclick = () => {
      closeModal()
      modalCancelBtn.style.display = 'inline-block'
    }
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

  return {
    openHelpGuideModal,
    openLicencesModal,
  }
}