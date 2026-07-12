import type { ModalContext } from './importModals'
import { registerVaultFromPath } from '../../lib/api/vaults'
import type { FolderPickerOptions } from '../folderPicker'

export interface VaultModalOptions {
  onRescanComplete?: () => void
  onVaultSwitch?: (result: import('../../lib/bridge').VaultSwitchResponse) => void | Promise<void>
}

export function setupVaultModals(
  ctx: ModalContext,
  folderPicker: { open: (opts: FolderPickerOptions) => void },
  opts: VaultModalOptions,
): {
  openAnotherVault: () => Promise<void>
  openSwitchVaultModal: () => Promise<void>
  runRescan: () => Promise<void>
} {
  const {
    closeModal,
    showNotification,
    modalTitle,
    modalBody,
    modalError,
    modalContainer,
    modalConfirmBtn,
    modalCancelBtn,
    bridge: b,
  } = ctx

  let vaultSwitchInProgress = false
  let rescanRunning = false

  // The modalContent element is accessed via modalContainer's parent — but the
  // original code references `modalContent` directly. We pass it via a query here
  // since the ModalContext interface doesn't include it. However the switch vault
  // modal uses `modalContent.classList.remove('modal-wide')`. We grab it from the DOM.
  const modalContent = document.getElementById('modal-content') as HTMLElement | null

  function showModalOverlay(): void {
    modalContainer.style.removeProperty('display')
    modalContainer.setAttribute('aria-hidden', 'false')
    modalContent?.classList.add('modal-wide')
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')
  }

  async function openAnotherVault(): Promise<void> {
    if (vaultSwitchInProgress) return
    try {
      vaultSwitchInProgress = true
      showNotification('Seleccionando carpeta…', 'info')

      folderPicker.open({
        mode: 'vault',
        title: 'Seleccionar carpeta raíz de la nueva biblioteca',
        confirmLabel: 'Abrir como biblioteca',
        onConfirm: async (path: string) => {
          try {
            showNotification('Registrando biblioteca…', 'info')
            const result = await registerVaultFromPath(path)
            showNotification(`Biblioteca abierta: ${result.vault.name}`, 'success')
            await opts.onVaultSwitch?.(result)
          } catch (err) {
            const msg = (err as Error).message || 'Error al registrar biblioteca'
            showNotification(msg, 'error')
          } finally {
            vaultSwitchInProgress = false
          }
        },
        onCancel: () => {
          vaultSwitchInProgress = false
          showNotification('Operación cancelada', 'info')
        },
      })
    } catch (err) {
      const msg = (err as Error).message || 'Error al abrir selector'
      showNotification(msg, 'error')
      vaultSwitchInProgress = false
    }
  }

  async function openSwitchVaultModal(): Promise<void> {
    if (vaultSwitchInProgress) return
    try {
      const list = await b.fetchVaults()
      modalTitle.textContent = 'Cambiar biblioteca'
      modalError.textContent = ''
      modalBody.innerHTML = ''
      modalConfirmBtn.style.display = 'none'
      modalCancelBtn.style.display = 'inline-block'
      modalContent?.classList.remove('modal-wide')

      if (list.vaults.length === 0) {
        modalBody.innerHTML =
          '<p style="margin:0;color:rgba(255,255,255,0.75)">No hay bibliotecas registradas. Usa «Abrir otra biblioteca…» primero.</p>'
      } else {
        const wrap = document.createElement('div')
        wrap.style.display = 'flex'
        wrap.style.flexDirection = 'column'
        wrap.style.gap = '8px'
        for (const v of list.vaults) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'menu-option'
          btn.style.textAlign = 'left'
          btn.disabled = !!v.active || vaultSwitchInProgress
          const label = v.active ? `${v.name} (activa)` : v.name
          const meta = v.node_count != null ? `${v.node_count} nodos` : v.path
          btn.innerHTML = `<strong>${label}</strong><br><span style="opacity:0.7;font-size:11px">${meta}</span>`
          btn.addEventListener('click', async () => {
            if (vaultSwitchInProgress) return
            vaultSwitchInProgress = true
            closeModal()
            showNotification(`Cargando ${v.name}…`, 'info')
            try {
              const result = await b.switchVault(v.id)
              showNotification(`Biblioteca activa: ${result.vault.name}`, 'success')
              await opts.onVaultSwitch?.(result)
            } catch (switchErr) {
              showNotification(`Error: ${(switchErr as Error).message}`, 'error')
            } finally {
              vaultSwitchInProgress = false
            }
          })
          wrap.appendChild(btn)
        }
        modalBody.appendChild(wrap)
      }
      showModalOverlay()
    } catch (err) {
      showNotification(`Error: ${(err as Error).message}`, 'error')
    }
  }

  async function runRescan(): Promise<void> {
    if (rescanRunning) return
    rescanRunning = true
    showNotification('Re-escaneando biblioteca…', 'info')
    try {
      const result = await b.triggerRescan()
      showNotification(
        `Escaneo completo: ${result.nodes} nodos, ${result.edges} aristas`,
        'success',
      )
      opts.onRescanComplete?.()
    } catch (err) {
      showNotification(`Error al re-escanear: ${(err as Error).message}`, 'error')
    } finally {
      rescanRunning = false
    }
  }

  return {
    openAnotherVault,
    openSwitchVaultModal,
    runRescan,
  }
}