import type { ModalContext } from './importModals'
import { registerVaultFromPath } from '../../lib/api/vaults'
import { browseDirectory } from '../../lib/api/browse'
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

  const modalContent = document.getElementById('modal-content') as HTMLElement | null

  function showModalOverlay(): void {
    modalContainer.style.removeProperty('display')
    modalContainer.setAttribute('aria-hidden', 'false')
    modalContent?.classList.add('modal-wide')
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')
  }

  /** Unified vault manager modal — list + add + switch in one place */
  async function openVaultManager(openPickerFirst: boolean): Promise<void> {
    if (vaultSwitchInProgress) return
    vaultSwitchInProgress = true

    try {
      if (openPickerFirst) {
        // "Abrir otra biblioteca" → go straight to folder picker
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
        return
      }

      // "Cambiar biblioteca" → show list with inline add button
      const list = await b.fetchVaults()
      modalTitle.textContent = 'Bibliotecas'
      modalError.textContent = ''
      modalBody.innerHTML = ''
      modalConfirmBtn.style.display = 'none'
      modalCancelBtn.style.display = 'inline-block'
      modalContent?.classList.remove('modal-wide')

      const wrap = document.createElement('div')
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;'

      // Header with count
      const header = document.createElement('div')
      header.style.cssText = 'color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:4px;'
      header.textContent = `${list.vaults.length} biblioteca(s) registrada(s). Click para activar.`
      wrap.appendChild(header)

      // Vault cards
      for (const v of list.vaults) {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'menu-option'
        card.style.cssText = 'text-align:left;padding:10px 12px;border-radius:6px;'

        const isActive = !!v.active
        const nameEl = isActive
          ? `<strong>${escapeHtml(v.name)}</strong> <span style="font-size:10px;color:#4fc3f7;">● activa</span>`
          : `<strong>${escapeHtml(v.name)}</strong>`
        const metaParts = []
        if (v.node_count != null) metaParts.push(`${v.node_count} nodos`)
        if (v.path) metaParts.push(escapeHtml(v.path.length > 50 ? '…' + v.path.slice(-47) : v.path))
        const meta = metaParts.join(' · ')

        card.innerHTML = `
          <div style="font-size:13px;">${nameEl}</div>
          <div style="opacity:0.6;font-size:11px;margin-top:2px;">${meta}</div>
        `
        card.disabled = isActive || vaultSwitchInProgress
        card.addEventListener('click', async () => {
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
        wrap.appendChild(card)
      }

      // Divider
      const divider = document.createElement('div')
      divider.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08);margin:6px 0;'
      wrap.appendChild(divider)

      // Add new vault button
      const addBtn = document.createElement('button')
      addBtn.type = 'button'
      addBtn.className = 'menu-option'
      addBtn.style.cssText = 'text-align:left;padding:10px 12px;border:1px dashed rgba(79,195,247,0.3);border-radius:6px;color:#4fc3f7;'
      addBtn.innerHTML = '<strong>+ Agregar nueva biblioteca</strong><br><span style="opacity:0.6;font-size:11px;">Selecciona una carpeta del sistema</span>'
      addBtn.addEventListener('click', () => {
        closeModal()
        // Open folder picker for new vault
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
          },
        })
      })
      wrap.appendChild(addBtn)

      modalBody.appendChild(wrap)
      showModalOverlay()
    } catch (err) {
      showNotification(`Error: ${(err as Error).message}`, 'error')
      vaultSwitchInProgress = false
    }
  }

  async function openAnotherVault(): Promise<void> {
    return openVaultManager(true)
  }

  async function openSwitchVaultModal(): Promise<void> {
    return openVaultManager(false)
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}