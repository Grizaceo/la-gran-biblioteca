import { browseDirectory } from '../lib/api/browse'
import type { BrowseResponse } from '../lib/api/types'

export type FolderPickerMode = 'vault' | 'folder' | 'file'

export interface FolderPickerOptions {
  mode: FolderPickerMode
  title: string
  confirmLabel?: string
  onConfirm: (path: string) => Promise<void>
  onCancel?: () => void
}

export interface FolderPickerHost {
  container: HTMLElement
  titleEl: HTMLElement
  bodyEl: HTMLElement
  errorEl: HTMLElement
  confirmBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
  closeBtn: HTMLElement
  show: () => void
  hide: () => void
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function mountFolderPicker(host: FolderPickerHost): {
  open: (opts: FolderPickerOptions) => void
} {
  let currentPath = ''
  let lastParent: string | null = null
  let loading = false
  let activeOpts: FolderPickerOptions | null = null

  const root = document.createElement('div')
  root.className = 'folder-picker'
  root.innerHTML = `
    <div class="folder-picker-roots" id="fp-roots"></div>
    <div class="folder-picker-toolbar">
      <button type="button" class="fp-btn" id="fp-up" title="Carpeta superior">↑</button>
      <input type="text" class="folder-picker-path" id="fp-path" readonly />
    </div>
    <div class="folder-picker-list" id="fp-list" role="listbox"></div>
    <p class="folder-picker-hint" id="fp-hint"></p>
  `
  host.bodyEl.innerHTML = ''
  host.bodyEl.appendChild(root)

  const rootsEl = root.querySelector('#fp-roots') as HTMLElement
  const upBtn = root.querySelector('#fp-up') as HTMLButtonElement
  const pathEl = root.querySelector('#fp-path') as HTMLInputElement
  const listEl = root.querySelector('#fp-list') as HTMLElement
  const hintEl = root.querySelector('#fp-hint') as HTMLElement

  function setError(msg: string): void {
    host.errorEl.textContent = msg
  }

  function includeFiles(): boolean {
    return activeOpts?.mode === 'file'
  }

  function canSelectPath(path: string, isDir: boolean): boolean {
    if (!activeOpts) return false
    if (activeOpts.mode === 'file') return !isDir
    return isDir
  }

  async function load(path?: string): Promise<void> {
    if (loading) return
    loading = true
    setError('')
    listEl.innerHTML = '<p class="folder-picker-empty">Cargando…</p>'
    try {
      const data: BrowseResponse = await browseDirectory(path, includeFiles())
      currentPath = data.path
      lastParent = data.parent
      pathEl.value = data.path
      upBtn.disabled = !data.parent
      renderRoots(data)
      renderEntries(data)
    } catch (err) {
      listEl.innerHTML = ''
      setError((err as Error).message || 'No se pudo listar la carpeta')
    } finally {
      loading = false
    }
  }

  function renderRoots(data: BrowseResponse): void {
    rootsEl.innerHTML = ''
    for (const r of data.roots) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'folder-picker-root-chip'
      chip.textContent = r.label
      chip.addEventListener('click', () => { void load(r.path) })
      rootsEl.appendChild(chip)
    }
  }

  function renderEntries(data: BrowseResponse): void {
    listEl.innerHTML = ''
    const dirs = data.entries.filter((e) => e.is_dir)
    const files = data.entries.filter((e) => !e.is_dir)

    if (!data.entries.length) {
      listEl.innerHTML = '<p class="folder-picker-empty">Carpeta vacía</p>'
      return
    }

    for (const entry of dirs) {
      listEl.appendChild(makeRow(entry.name, entry.path, true))
    }
    if (includeFiles()) {
      for (const entry of files) {
        listEl.appendChild(makeRow(entry.name, entry.path, false))
      }
    }
  }

  function makeRow(name: string, path: string, isDir: boolean): HTMLElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `folder-picker-row${isDir ? ' is-dir' : ' is-file'}`
    row.innerHTML = `<span class="fp-icon">${isDir ? '📁' : '📄'}</span><span>${escapeHtml(name)}</span>`
    row.addEventListener('dblclick', () => {
      if (isDir) void load(path)
      else if (canSelectPath(path, false)) void confirm(path)
    })
    row.addEventListener('click', () => {
      if (isDir) {
        for (const el of listEl.querySelectorAll('.folder-picker-row.selected')) {
          el.classList.remove('selected')
        }
        row.classList.add('selected')
        currentPath = path
        pathEl.value = path
      } else if (canSelectPath(path, false)) {
        for (const el of listEl.querySelectorAll('.folder-picker-row.selected')) {
          el.classList.remove('selected')
        }
        row.classList.add('selected')
        currentPath = path
        pathEl.value = path
      }
    })
    return row
  }

  async function confirm(selectedPath?: string): Promise<void> {
    if (!activeOpts || loading) return
    const path = selectedPath ?? currentPath
    if (!path) {
      setError('Selecciona una ruta')
      return
    }
    loading = true
    host.confirmBtn.disabled = true
    host.confirmBtn.textContent = 'Procesando…'
    setError('')
    try {
      await activeOpts.onConfirm(path)
      activeOpts = null
      host.hide()
    } catch (err) {
      setError((err as Error).message || 'Error')
    } finally {
      loading = false
      host.confirmBtn.disabled = false
      host.confirmBtn.textContent = activeOpts?.confirmLabel ?? 'Seleccionar'
    }
  }

  upBtn.addEventListener('click', () => {
    if (lastParent) void load(lastParent)
  })

  host.confirmBtn.onclick = () => { void confirm() }
  host.cancelBtn.onclick = () => {
    activeOpts?.onCancel?.()
    activeOpts = null
    host.hide()
  }
  host.closeBtn.onclick = () => {
    activeOpts?.onCancel?.()
    activeOpts = null
    host.hide()
  }

  function open(opts: FolderPickerOptions): void {
    activeOpts = opts
    host.titleEl.textContent = opts.title
    host.confirmBtn.textContent = opts.confirmLabel ?? 'Seleccionar'
    host.confirmBtn.style.display = 'inline-block'
    host.cancelBtn.style.display = 'inline-block'
    host.confirmBtn.disabled = false
    setError('')
    hintEl.textContent = opts.mode === 'vault'
      ? 'Elige la carpeta raíz de la biblioteca. Doble clic en una carpeta para entrar.'
      : opts.mode === 'file'
        ? 'Elige un archivo para importar al vault activo.'
        : 'Elige una carpeta para copiar al vault activo.'
    host.show()
    void load()
  }

  return { open }
}
