import type { Node, Graph } from '../lib/bridge'
import { fetchNodeContent, openNode, studyNode, fetchNode } from '../lib/bridge'
import { PALETTE } from '../render3d/palette.js'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

let hljsPromise: Promise<typeof import('highlight.js').default> | null = null

async function getHljs() {
  if (!hljsPromise) {
    hljsPromise = Promise.all([
      import('highlight.js'),
      import('highlight.js/styles/github-dark.css'),
    ]).then(([mod]) => mod.default)
  }
  return hljsPromise
}

const ESC_RE = /[&<>"']/g
const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(ESC_RE, c => ESC_MAP[c])
}
function escapeAttr(s: string | null | undefined): string {
  return escapeHtml(s)
}

const NON_FILE_TYPES = new Set(['folder', 'workspace', 'project'])

interface Engine {
  fg: {
    graphData(): { nodes: Array<Record<string, unknown>> }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cameraPosition(to: { x: number; y: number; z: number }, lookAt?: { x: number; y: number; z: number }, duration?: number): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    width(w: number): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    height(h: number): any
  }
  pause(): void
  resume(): void
}

export interface DetailPanelAPI {
  selectNode(nodeId: string, waitForCameraMs?: number): Promise<void>
  refreshNeighbors(nodeId: string): void
  getCurrentNodeId(): string | null
}

export function setupDetailPanel(
  container: HTMLElement,
  engine: Engine,
  getCurrentGraph: () => Graph | null,
  showToast: (msg: string, isError?: boolean) => void,
): DetailPanelAPI {
  const detailPanel     = document.getElementById('node-detail')!
  const detailName      = document.getElementById('node-detail-name')!
  const detailType      = document.getElementById('node-detail-type')!
  const detailPath      = document.getElementById('node-detail-path')!
  const detailMeta      = document.getElementById('node-detail-meta')!
  const detailClose     = document.getElementById('node-detail-close')!
  const detailActions   = document.getElementById('node-detail-actions')!
  const detailPreview   = document.getElementById('node-detail-preview')!
  const detailNeighbors = document.getElementById('node-detail-neighbors')!

  let currentNodeId: string | null = null

  function closePanel(): void {
    detailPanel.classList.remove('active')
    container.style.right = '0'
    engine.resume()
    setTimeout(() => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
    }, 320)
    currentNodeId = null
  }

  detailClose.addEventListener('click', closePanel)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailPanel.classList.contains('active')) closePanel()
  })

  function renderNeighbors(nodeId: string): void {
    const graph = getCurrentGraph()
    if (!graph) { detailNeighbors.innerHTML = ''; return }

    const neighborIds = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.source === nodeId) neighborIds.add(edge.target)
      else if (edge.target === nodeId) neighborIds.add(edge.source)
    }

    const neighbors = graph.nodes.filter(n => neighborIds.has(n.id)).slice(0, 30)
    if (!neighbors.length) { detailNeighbors.innerHTML = ''; return }

    const more = neighborIds.size > 30
      ? `<div class="neighbor-more">+${neighborIds.size - 30} más</div>`
      : ''

    detailNeighbors.innerHTML = `
      <div class="detail-section-title">Vecinos (${neighborIds.size})</div>
      <div class="neighbor-list">
        ${neighbors.map(n => {
          const color = (PALETTE as Record<string, string>)[n.type] ?? (PALETTE as Record<string, string>).default
          const name = n.label || n.id
          const short = name.length > 36 ? name.slice(0, 34) + '…' : name
          return `<div class="neighbor-item" data-id="${escapeAttr(n.id)}">
            <span class="neighbor-dot" style="background:${color}"></span>
            <span class="neighbor-name">${escapeHtml(short)}</span>
            <span class="neighbor-type">${escapeHtml(n.type)}</span>
          </div>`
        }).join('')}
        ${more}
      </div>`

    detailNeighbors.querySelectorAll('.neighbor-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id!
        selectNode(id)
      })
    })
  }

  async function renderPreview(node: Node): Promise<void> {
    if (NON_FILE_TYPES.has(node.type) || !node.path) {
      detailPreview.innerHTML = ''
      return
    }

    detailPreview.innerHTML = '<div class="preview-loading">Cargando vista previa…</div>'

    try {
      const result = await fetchNodeContent(node.id)
      const { content, lang, truncated } = result

      let html = ''
      if (lang === 'markdown') {
        html = DOMPurify.sanitize(await Promise.resolve(marked.parse(content)))
      } else {
        const hljs = await getHljs()
        const highlighted = lang
          ? hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(content).value
        html = `<pre class="hljs"><code>${highlighted}</code></pre>`
      }

      const truncNote = truncated
        ? '<div class="preview-truncated">Vista previa truncada a 2 MB — usa "Abrir" para ver el archivo completo.</div>'
        : ''

      detailPreview.innerHTML = `
        <div class="detail-section-title">Vista previa</div>
        ${truncNote}
        <div class="preview-content markdown-body">${html}</div>`
    } catch (err: unknown) {
      const status = err instanceof Error ? err.message : String(err)
      if (status === '415') {
        detailPreview.innerHTML = '<div class="preview-unavailable">Vista previa no disponible para este tipo · usa "Abrir".</div>'
      } else if (status === '403') {
        detailPreview.innerHTML = ''
      } else {
        detailPreview.innerHTML = '<div class="preview-unavailable">No se pudo cargar la vista previa.</div>'
      }
    }
  }

  function renderActions(node: Node): void {
    if (!node.path) { detailActions.innerHTML = ''; return }

    if (node.type === 'folder') {
      detailActions.innerHTML = `<button class="detail-btn" id="btn-open-folder">Abrir carpeta</button>`
      document.getElementById('btn-open-folder')!.addEventListener('click', async () => {
        try {
          await openNode(node.id, false)
        } catch (err) {
          showToast(`No se pudo abrir la carpeta: ${(err as Error).message}`, true)
        }
      })
      return
    }

    if (NON_FILE_TYPES.has(node.type)) { detailActions.innerHTML = ''; return }

    detailActions.innerHTML = `
      <button class="detail-btn" id="btn-open-file">Abrir</button>
      <button class="detail-btn" id="btn-reveal-file">Revelar</button>`

    document.getElementById('btn-open-file')!.addEventListener('click', async () => {
      try {
        await openNode(node.id, false)
      } catch (err) {
        showToast(`No se pudo abrir: ${(err as Error).message}`, true)
      }
    })

    document.getElementById('btn-reveal-file')!.addEventListener('click', async () => {
      try {
        await openNode(node.id, true)
      } catch (err) {
        showToast(`No se pudo revelar: ${(err as Error).message}`, true)
      }
    })
  }

  async function renderDetailPanel(node: Node): Promise<void> {
    const color = (PALETTE as Record<string, string>)[node.type] ?? (PALETTE as Record<string, string>).default
    detailName.textContent      = node.label
    detailType.textContent      = node.type
    ;(detailType as HTMLElement).style.background = color
    detailPath.textContent      = node.path ?? ''

    const meta = node.metadata ?? {}
    const rows = Object.entries(meta)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<div class="detail-meta-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`)
      .join('')
    detailMeta.innerHTML = rows
      || '<div class="detail-meta-row"><span style="opacity:.4">sin metadatos</span></div>'

    renderActions(node)
    renderNeighbors(node.id)

    detailPanel.classList.add('active')
    container.style.right = 'var(--detail-panel-width, 480px)'
    setTimeout(() => {
      const { width, height } = container.getBoundingClientRect()
      engine.fg.width(width).height(height)
    }, 50)
    engine.pause()

    renderPreview(node).catch(() => {})
  }

  async function selectNode(nodeId: string, waitForCameraMs = 0): Promise<void> {
    const CAMERA_ANIM_MS = 800
    const t0 = Date.now()

    const graphData = engine.fg.graphData()
    const graphNode = graphData.nodes.find((n: Record<string, unknown>) => n.id === nodeId)

    if (graphNode) {
      const nx = (graphNode.x as number) || 0
      const ny = (graphNode.y as number) || 0
      const nz = (graphNode.z as number) || 0
      const dist = 80
      const hyp  = Math.hypot(nx, ny, nz) || 1
      const ratio = 1 + dist / hyp
      engine.fg.cameraPosition(
        { x: nx * ratio, y: ny * ratio, z: nz * ratio },
        { x: nx, y: ny, z: nz },
        CAMERA_ANIM_MS,
      )
    }

    try {
      await studyNode(nodeId)
      const detail = await fetchNode(nodeId)
      currentNodeId = nodeId

      // When called from autofocus, wait for the camera animation to finish
      // before opening the panel so the user can see the graph navigate to the node.
      if (waitForCameraMs > 0) {
        const elapsed = Date.now() - t0
        const remaining = Math.max(0, waitForCameraMs - elapsed)
        if (remaining > 0) await new Promise<void>(r => setTimeout(r, remaining))
      }

      await renderDetailPanel(detail)
    } catch (err) {
      console.warn('[LGB] selectNode failed:', err)
    }
  }

  return {
    selectNode,
    refreshNeighbors: renderNeighbors,
    getCurrentNodeId: () => currentNodeId,
  }
}
