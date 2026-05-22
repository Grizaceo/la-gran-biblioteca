// src/lib/bridge.ts - Fetch al backend + SSE para actualizaciones

/** Proxy Vite en dev (`/api`). Override: VITE_API_BASE=http://127.0.0.1:3001/api */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

/** Fallback directo si el proxy falla (p. ej. localhost→::1 en WSL). */
const API_DIRECT =
  (import.meta.env.VITE_API_DIRECT as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:3001/api'

const API_KEY = import.meta.env.VITE_LGB_API_KEY as string | undefined

const GRAPH_FETCH_MS = 120_000

function joinApi(path: string, base: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const bases = API_BASE === '/api' && import.meta.env.DEV
    ? [API_BASE, API_DIRECT]
    : [API_BASE]

  let lastErr: unknown
  for (const base of bases) {
    try {
      const res = await fetch(joinApi(path, base), init)
      return res
    } catch (err) {
      lastErr = err
      if (base !== bases[bases.length - 1]) continue
    }
  }
  const hint =
    lastErr instanceof TypeError
      ? ' (¿proxy caído? Reinicia: npm run dev en frontend/; backend en :3001)'
      : ''
  throw new Error(`${lastErr instanceof Error ? lastErr.message : String(lastErr)}${hint}`)
}

function streamUrl(): string {
  if (API_BASE !== '/api') return joinApi('/stream', API_BASE)
  return joinApi('/stream', API_BASE)
}

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY
  }
  return headers
}

export interface Node {
  id: string
  type: string
  label: string
  path: string
  metadata: Record<string, unknown>
  position: { x: number; y: number; z?: number }
}

export interface Edge {
  source: string
  target: string
  type: string
}

export interface Graph {
  nodes: Node[]
  edges: Edge[]
  total?: number
}

export interface Overview {
  total_nodes: number
  total_edges: number
  by_type: Record<string, number>
  top_workspaces: Array<{ workspace: string; nodes: number }>
  recent_imports: string[]
  workspace_root: string
}

export type GraphUpdateEvent = 'init' | 'update'

export async function fetchOverview(): Promise<Overview> {
  const res = await apiFetch('/overview')
  if (!res.ok) throw new Error(`Failed to fetch overview: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchGraph(): Promise<Graph> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GRAPH_FETCH_MS)
  try {
    const res = await apiFetch('/graph', { signal: controller.signal })
    if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status} ${res.statusText}`)
    return res.json()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timeout cargando el grafo (>${GRAPH_FETCH_MS / 1000}s)`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchNode(id: string): Promise<Node> {
  const res = await apiFetch(`/node/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Failed to fetch node ${id}: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function studyNode(id: string): Promise<any> {
  const res = await apiFetch('/study', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ node_id: id }),
  })
  if (!res.ok) throw new Error(`Failed to study node ${id}: ${res.status} ${res.statusText}`)
  return res.json()
}

export interface NodeContent {
  content: string
  lang: string
  size: number
  truncated: boolean
}

export async function fetchNodeContent(id: string): Promise<NodeContent> {
  const res = await apiFetch(`/node/${encodeURIComponent(id)}/content`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function openNode(id: string, reveal: boolean): Promise<void> {
  const res = await apiFetch('/open', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ node_id: id, reveal }),
  })
  if (!res.ok) await handleResponseError(res, `Error al abrir nodo (${res.status})`)
}

export async function triggerRescan(): Promise<{ status: string; nodes: number; edges: number }> {
  const res = await apiFetch('/rescan', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo re-escanear la biblioteca')
  return res.json()
}

export function subscribeToUpdates(
  onUpdate: (graph: Graph, event: GraphUpdateEvent) => void,
  onError?: (err: Error) => void
): () => void {
  const evtSource = new EventSource(streamUrl())

  evtSource.addEventListener('init', (e: MessageEvent) => {
    onUpdate(JSON.parse(e.data), 'init')
  })

  evtSource.addEventListener('update', (e: MessageEvent) => {
    onUpdate(JSON.parse(e.data), 'update')
  })

  evtSource.onerror = () => {
    onError?.(new Error('SSE connection error'))
  }

  return () => evtSource.close()
}

async function handleResponseError(res: Response, fallbackMsg: string): Promise<never> {
  const data = await res.json().catch(() => null)
  if (data?.detail) {
    if (typeof data.detail === 'string') throw new Error(data.detail)
    if (Array.isArray(data.detail)) throw new Error(data.detail.map((d: any) => d.msg).join(', '))
  }
  throw new Error(fallbackMsg)
}

export async function createFile(path: string, content: string = ''): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/file', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo crear el archivo '${path}'`)
  }
  return res.json()
}

export async function createFolder(path: string): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/folder', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo crear la carpeta '${path}'`)
  }
  return res.json()
}

export async function importGithub(url: string): Promise<ImportNoteResponse> {
  const res = await apiFetch('/create/github', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo importar el repositorio de GitHub: ${url}`)
  }
  return res.json()
}

export interface ArxivSearchHit {
  arxiv_id: string
  title: string
  authors: string[]
  published: string
  updated: string
  categories: string[]
  abstract: string
  abs_url: string
  pdf_url: string
  withdrawn?: boolean
}

export interface ArxivSearchResponse {
  total: number | null
  results: ArxivSearchHit[]
}

export async function searchArxiv(params: {
  q?: string
  author?: string
  cat?: string
  max?: number
  sort?: 'relevance' | 'date'
}): Promise<ArxivSearchResponse> {
  const sp = new URLSearchParams()
  if (params.q?.trim()) sp.set('q', params.q.trim())
  if (params.author?.trim()) sp.set('author', params.author.trim())
  if (params.cat?.trim()) sp.set('cat', params.cat.trim())
  if (params.max != null) sp.set('max', String(params.max))
  if (params.sort) sp.set('sort', params.sort)
  const qs = sp.toString()
  const res = await apiFetch(`/arxiv/search${qs ? `?${qs}` : ''}`)
  if (!res.ok) {
    await handleResponseError(res, 'No se pudo buscar en arXiv')
  }
  return res.json()
}

export interface ImportNoteResponse {
  status: string
  path: string
  node_id?: string
  workspace_root?: string
}

export async function importArxiv(id: string): Promise<ImportNoteResponse> {
  const res = await apiFetch('/create/arxiv', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo importar el artículo de arXiv: ${id}`)
  }
  return res.json()
}

export async function importPubmed(id: string): Promise<ImportNoteResponse> {
  const res = await apiFetch('/create/pubmed', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo importar el artículo de PubMed: ${id}`)
  }
  return res.json()
}

export async function createSystemFile(): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/system-file', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo seleccionar o importar el archivo del sistema`)
  }
  return res.json()
}

export async function createSystemFolder(): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/system-folder', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo seleccionar o importar la carpeta del sistema`)
  }
  return res.json()
}

export interface ConstellationCatalogEntry {
  id: string
  name: string
  name_es?: string
  star_count: number
}

export interface ConstellationPref {
  folder_path: string
  constellation_id: string
  status: 'suggested' | 'confirmed'
  suggested_from?: string
  updated_at?: string
}

export async function fetchConstellationCatalog(): Promise<{ constellations: ConstellationCatalogEntry[] }> {
  const res = await apiFetch('/constellation/catalog')
  if (!res.ok) throw new Error(`Failed to fetch constellation catalog: ${res.status}`)
  return res.json()
}

export async function fetchConstellationPrefs(): Promise<{
  prefs: ConstellationPref[]
  pending: ConstellationPref[]
}> {
  const res = await apiFetch('/constellation/prefs')
  if (!res.ok) throw new Error(`Failed to fetch constellation prefs: ${res.status}`)
  return res.json()
}

export async function saveConstellationPref(
  folderPath: string,
  constellationId: string,
  status: 'confirmed' | 'suggested' = 'confirmed',
): Promise<{ status: string; pref: ConstellationPref }> {
  const res = await apiFetch('/constellation/prefs', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      folder_path: folderPath,
      constellation_id: constellationId,
      status,
    }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo guardar la constelación')
  return res.json()
}

export async function deleteConstellationPref(folderPath: string): Promise<{ status: string }> {
  const sp = new URLSearchParams({ folder_path: folderPath })
  const res = await apiFetch(`/constellation/prefs?${sp}`, {
    method: 'DELETE',
    headers: apiHeaders(),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo quitar la asignación')
  return res.json()
}

export async function triggerConstellationRelayout(): Promise<{ status: string; nodes: number; edges: number }> {
  const res = await apiFetch('/constellation/relayout', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo recalcular el layout')
  return res.json()
}