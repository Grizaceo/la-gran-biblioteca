import { Graph3DEngine } from '../../render3d/Graph3DEngine'
import * as bridge from '../../lib/bridge'
import type { ModalField } from './modalShell'

export interface ModalContext {
  showModal: (
    title: string,
    fields: ModalField[],
    onSubmit: (values: Record<string, string>) => Promise<void>,
  ) => void
  closeModal: () => void
  showNotification: (msg: string, type?: 'info' | 'success' | 'error') => void
  modalTitle: HTMLElement
  modalBody: HTMLElement
  modalError: HTMLElement
  modalContainer: HTMLElement
  modalConfirmBtn: HTMLButtonElement
  modalCancelBtn: HTMLButtonElement
  modalCloseBtn: HTMLElement
  engine: Graph3DEngine
  bridge: typeof bridge
}

export function setupImportModals(ctx: ModalContext): {
  openImportGithubModal: () => void
  openImportArxivModal: () => void
  openImportPubmedModal: () => void
} {
  const {
    showModal,
    closeModal,
    showNotification,
    modalTitle,
    modalBody,
    modalError,
    modalContainer,
    modalConfirmBtn,
    modalCancelBtn,
    modalCloseBtn,
    engine,
    bridge: b,
  } = ctx

  function openImportGithubModal(): void {
    showModal(
      'Importar Repositorio GitHub',
      [
        {
          label: 'Repositorio Público (ej: owner/repo o URL)',
          id: 'url',
          type: 'text',
          placeholder: 'https://github.com/usuario/repositorio...',
        },
      ],
      async (values) => {
        const url = values.url.trim()
        if (!url) throw new Error('El repositorio es obligatorio')
        showNotification('Iniciando descarga de GitHub...', 'info')
        if ((window as any).addActivityLog) {
          ;(window as any).addActivityLog(`Descargando repositorio GitHub: ${url}...`, 'info')
        }
        const res = await b.importGithub(url)
        engine.ensureImportsWorkspaceVisible()
        const vaultHint = res.workspace_root ? `${res.workspace_root}/${res.path}` : res.path
        const repoStem = res.path.split('/').pop() || res.path
        showNotification(
          `Repositorio importado: ${res.path} — Ctrl+K «${repoStem}» (workspace imports)`,
          'success',
        )
        if ((window as any).addActivityLog) {
          ;(window as any).addActivityLog(
            `GitHub importado en: ${vaultHint}${res.node_id ? ` (nodo ${res.node_id})` : ''}. Esperando actualización del grafo…`,
            'success',
          )
        }
        engine.enqueuePendingFocus(res.path)
        if (res.node_id) engine.enqueuePendingFocus(res.node_id)
      },
    )
  }

  function openImportArxivModal(): void {
    modalTitle.textContent = 'Importar de arXiv'
    modalError.textContent = ''
    modalCancelBtn.style.display = 'inline-block'
    modalConfirmBtn.style.display = 'none'

    let activeTab: 'search' | 'id' = 'search'
    let searchLoading = false
    let importLoading = false
    let searchResults: bridge.ArxivSearchHit[] = []
    let selectedHit: bridge.ArxivSearchHit | null = null

    const panelStyle =
      'color:rgba(255,255,255,0.85);font-family:\'Helvetica Neue\',Arial,sans-serif;font-size:12px;display:flex;flex-direction:column;gap:12px;'

    modalBody.innerHTML = `
      <div id="arxiv-modal-root" style="${panelStyle}">
        <div style="display:flex;gap:8px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
          <button type="button" id="arxiv-tab-search" class="arxiv-tab active" style="flex:1;padding:6px 10px;border:1px solid rgba(79,195,247,0.4);background:rgba(79,195,247,0.15);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;">Buscar</button>
          <button type="button" id="arxiv-tab-id" class="arxiv-tab" style="flex:1;padding:6px 10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;font-size:12px;">Por ID o URL</button>
        </div>
        <div id="arxiv-panel-search">
          <label style="display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.7);">
            Consulta
            <input id="arxiv-search-q" type="text" placeholder="tema, palabras clave…" style="padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:#fff;" />
          </label>
          <div style="display:flex;gap:8px;">
            <label style="flex:1;display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.5);font-size:11px;">
              Autor (opcional)
              <input id="arxiv-search-author" type="text" placeholder="nombre autor" style="padding:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:11px;" />
            </label>
            <label style="flex:1;display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.5);font-size:11px;">
              Categoría (opcional)
              <input id="arxiv-search-cat" type="text" placeholder="cs.CL" style="padding:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:11px;" />
            </label>
          </div>
          <button type="button" id="arxiv-search-btn" style="padding:8px 14px;background:rgba(79,195,247,0.25);border:1px solid rgba(79,195,247,0.5);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;align-self:flex-start;">Buscar</button>
          <div id="arxiv-search-status" style="font-size:11px;color:rgba(255,255,255,0.45);min-height:14px;"></div>
          <div id="arxiv-results" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;border:1px solid rgba(255,255,255,0.06);border-radius:4px;padding:6px;min-height:48px;"></div>
          <button type="button" id="arxiv-import-selected" disabled style="padding:8px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.35);border-radius:4px;cursor:not-allowed;font-size:12px;align-self:flex-start;">Importar seleccionado</button>
        </div>
        <div id="arxiv-panel-id" style="display:none;">
          <label style="display:flex;flex-direction:column;gap:4px;color:rgba(255,255,255,0.7);">
            ID de arXiv o URL (ej: 2303.08774)
            <input id="arxiv-id-input" type="text" placeholder="Identificador del paper en arXiv…" style="padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:#fff;" />
          </label>
          <button type="button" id="arxiv-import-id-btn" style="padding:8px 14px;background:rgba(79,195,247,0.25);border:1px solid rgba(79,195,247,0.5);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;align-self:flex-start;margin-top:4px;">Importar</button>
        </div>
      </div>
    `

    const tabSearch = document.getElementById('arxiv-tab-search') as HTMLButtonElement
    const tabId = document.getElementById('arxiv-tab-id') as HTMLButtonElement
    const panelSearch = document.getElementById('arxiv-panel-search') as HTMLElement
    const panelId = document.getElementById('arxiv-panel-id') as HTMLElement
    const searchQ = document.getElementById('arxiv-search-q') as HTMLInputElement
    const searchAuthor = document.getElementById('arxiv-search-author') as HTMLInputElement
    const searchCat = document.getElementById('arxiv-search-cat') as HTMLInputElement
    const searchBtn = document.getElementById('arxiv-search-btn') as HTMLButtonElement
    const searchStatus = document.getElementById('arxiv-search-status') as HTMLElement
    const resultsEl = document.getElementById('arxiv-results') as HTMLElement
    const importSelectedBtn = document.getElementById('arxiv-import-selected') as HTMLButtonElement
    const idInput = document.getElementById('arxiv-id-input') as HTMLInputElement
    const importIdBtn = document.getElementById('arxiv-import-id-btn') as HTMLButtonElement

    const tabActiveStyle =
      'flex:1;padding:6px 10px;border:1px solid rgba(79,195,247,0.4);background:rgba(79,195,247,0.15);color:#4fc3f7;border-radius:4px;cursor:pointer;font-size:12px;'
    const tabInactiveStyle =
      'flex:1;padding:6px 10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;font-size:12px;'

    function setTab(tab: 'search' | 'id'): void {
      activeTab = tab
      tabSearch.style.cssText = tab === 'search' ? tabActiveStyle : tabInactiveStyle
      tabId.style.cssText = tab === 'id' ? tabActiveStyle : tabInactiveStyle
      panelSearch.style.display = tab === 'search' ? 'flex' : 'none'
      panelId.style.display = tab === 'id' ? 'block' : 'none'
      panelSearch.style.flexDirection = 'column'
      panelSearch.style.gap = '12px'
    }

    function updateImportSelectedBtn(): void {
      const enabled = !!selectedHit && !importLoading
      importSelectedBtn.disabled = !enabled
      importSelectedBtn.style.cursor = enabled ? 'pointer' : 'not-allowed'
      importSelectedBtn.style.color = enabled ? '#4fc3f7' : 'rgba(255,255,255,0.35)'
      importSelectedBtn.style.background = enabled
        ? 'rgba(79,195,247,0.25)'
        : 'rgba(255,255,255,0.08)'
      importSelectedBtn.style.borderColor = enabled
        ? 'rgba(79,195,247,0.5)'
        : 'rgba(255,255,255,0.15)'
    }

    function renderResults(): void {
      resultsEl.innerHTML = ''
      if (!searchResults.length) {
        resultsEl.innerHTML =
          '<span style="color:rgba(255,255,255,0.35);font-size:11px;padding:4px;">Sin resultados. Pulsa Buscar.</span>'
        return
      }
      for (const hit of searchResults) {
        const row = document.createElement('button')
        row.type = 'button'
        const withdrawn = !!hit.withdrawn
        const selected = selectedHit?.arxiv_id === hit.arxiv_id
        row.style.cssText = [
          'text-align:left;padding:8px;border-radius:4px;cursor:pointer;',
          'border:1px solid',
          selected ? 'rgba(79,195,247,0.55)' : 'rgba(255,255,255,0.08)',
          'background:',
          selected ? 'rgba(79,195,247,0.12)' : 'rgba(0,0,0,0.2)',
          withdrawn ? 'opacity:0.55;' : '',
        ].join(' ')
        const authors = hit.authors?.slice(0, 3).join(', ') || '—'
        const snippet = (hit.abstract || '').slice(0, 120)
        row.innerHTML = `
          <div style="font-size:12px;color:${withdrawn ? 'rgba(255,180,100,0.85)' : '#e0e0e0'};font-weight:500;">${escapeHtml(hit.title)}${withdrawn ? ' <span style="font-size:10px;color:#ffb74d;">(retirado)</span>' : ''}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:2px;">${escapeHtml(authors)} · ${escapeHtml(hit.published || '')} · ${escapeHtml(hit.arxiv_id)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:4px;line-height:1.4;">${escapeHtml(snippet)}${(hit.abstract || '').length > 120 ? '…' : ''}</div>
        `
        row.onclick = () => {
          selectedHit = hit
          renderResults()
          updateImportSelectedBtn()
        }
        resultsEl.appendChild(row)
      }
    }

    function escapeHtml(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    async function runImport(arxivId: string): Promise<void> {
      const id = arxivId.trim()
      if (!id) throw new Error('El identificador de arXiv es obligatorio')
      showNotification('Consultando arXiv API...', 'info')
      if ((window as any).addActivityLog) {
        ;(window as any).addActivityLog(`Importando arXiv ID: ${id}...`, 'info')
      }
      const res = await b.importArxiv(id)
      const vaultHint = res.workspace_root ? `${res.workspace_root}/${res.path}` : res.path
      showNotification(
        `Importado en el vault: ${res.path} — busca en el grafo o Ctrl+K por título`,
        'success',
      )
      if ((window as any).addActivityLog) {
        ;(window as any).addActivityLog(
          `arXiv guardado: ${vaultHint}${res.node_id ? ` (nodo ${res.node_id})` : ''}. Sincronizando grafo…`,
          'success',
        )
      }
      const queue = (engine as any)._pendingFocusQueue ??= []
      queue.push(res.path)
      if (res.node_id) queue.push(res.node_id)
      closeModal()
    }

    async function doSearch(): Promise<void> {
      const q = searchQ.value.trim()
      const author = searchAuthor.value.trim()
      const cat = searchCat.value.trim()
      if (!q && !author && !cat) {
        searchStatus.textContent = 'Indica consulta, autor o categoría.'
        searchStatus.style.color = '#ffb74d'
        return
      }
      searchLoading = true
      searchBtn.disabled = true
      searchBtn.textContent = 'Buscando…'
      searchStatus.textContent = ''
      searchStatus.style.color = 'rgba(255,255,255,0.45)'
      selectedHit = null
      updateImportSelectedBtn()
      try {
        const data = await b.searchArxiv({
          q: q || undefined,
          author: author || undefined,
          cat: cat || undefined,
          max: 15,
        })
        searchResults = data.results
        const totalHint = data.total != null ? ` (${data.total} en arXiv)` : ''
        searchStatus.textContent = `${searchResults.length} resultado(s)${totalHint}`
        renderResults()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('403')) {
          searchStatus.textContent =
            'arXiv bloqueó la petición (403). Espera unos segundos e inténtalo de nuevo.'
        } else {
          searchStatus.textContent = msg
        }
        searchStatus.style.color = '#ef5350'
        searchResults = []
        renderResults()
      } finally {
        searchLoading = false
        searchBtn.disabled = false
        searchBtn.textContent = 'Buscar'
      }
    }

    tabSearch.onclick = () => setTab('search')
    tabId.onclick = () => setTab('id')
    searchBtn.onclick = () => void doSearch()
    searchQ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void doSearch()
    })

    importSelectedBtn.onclick = async () => {
      if (!selectedHit || importLoading) return
      importLoading = true
      updateImportSelectedBtn()
      importSelectedBtn.textContent = 'Importando…'
      modalError.textContent = ''
      try {
        await runImport(selectedHit.arxiv_id)
      } catch (err: unknown) {
        modalError.textContent = err instanceof Error ? err.message : 'Error al importar'
        importLoading = false
        importSelectedBtn.textContent = 'Importar seleccionado'
        updateImportSelectedBtn()
      }
    }

    importIdBtn.onclick = async () => {
      if (importLoading) return
      importLoading = true
      importIdBtn.disabled = true
      importIdBtn.textContent = 'Importando…'
      modalError.textContent = ''
      try {
        await runImport(idInput.value)
      } catch (err: unknown) {
        modalError.textContent = err instanceof Error ? err.message : 'Error al importar'
        importLoading = false
        importIdBtn.disabled = false
        importIdBtn.textContent = 'Importar'
      }
    }

    setTab('search')
    renderResults()
    updateImportSelectedBtn()

    modalContainer.style.display = 'flex'
    void modalContainer.offsetWidth
    modalContainer.classList.add('active')

    modalCloseBtn.onclick = () => closeModal()
    modalCancelBtn.onclick = () => closeModal()
  }

  function openImportPubmedModal(): void {
    showModal(
      'Importar de PubMed',
      [
        {
          label: 'PMID de PubMed o URL (ej: 36915867)',
          id: 'pmid',
          type: 'text',
          placeholder: 'Identificador del artículo en PubMed...',
        },
      ],
      async (values) => {
        const pmid = values.pmid.trim()
        if (!pmid) throw new Error('El PMID de PubMed es obligatorio')
        showNotification('Consultando PubMed API...', 'info')
        if ((window as any).addActivityLog) {
          ;(window as any).addActivityLog(`Buscando PubMed PMID: ${pmid}...`, 'info')
        }
        const res = await b.importPubmed(pmid)
        showNotification(`Artículo importado como Markdown en: ${res.path}`, 'success')
        if ((window as any).addActivityLog) {
          ;(window as any).addActivityLog(
            `PubMed importado en: ${res.path}. Esperando actualización del grafo...`,
            'success',
          )
        }
        engine.enqueuePendingFocus(res.path)
      },
    )
  }

  return {
    openImportGithubModal,
    openImportArxivModal,
    openImportPubmedModal,
  }
}