// src/lib/bridge.ts - Fetch al backend + SSE para actualizaciones

const API_BASE = '/api'

export interface Node {
  id: string
  type: string
  label: string
  path: string
  metadata: Record<string, unknown>
  position: { x: number; y: number }
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

export async function fetchGraph(): Promise<Graph> {
  const res = await fetch(`${API_BASE}/graph`)
  if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchNode(id: string): Promise<Node> {
  const res = await fetch(`${API_BASE}/node/${id}`)
  if (!res.ok) throw new Error(`Failed to fetch node ${id}: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function studyNode(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/study`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: id })
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
  const res = await fetch(`${API_BASE}/node/${encodeURIComponent(id)}/content`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function openNode(id: string, reveal: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: id, reveal }),
  })
  if (!res.ok) throw new Error(`${res.status}`)
}

export function subscribeToUpdates(
  onUpdate: (graph: Graph) => void,
  onError?: (err: Error) => void
): () => void {
  const evtSource = new EventSource(`${API_BASE}/stream`)

  evtSource.addEventListener('init', (e: MessageEvent) => {
    onUpdate(JSON.parse(e.data))
  })

  evtSource.addEventListener('update', (e: MessageEvent) => {
    onUpdate(JSON.parse(e.data))
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
  const res = await fetch(`${API_BASE}/create/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo crear el archivo '${path}'`)
  }
  return res.json()
}

export async function createFolder(path: string): Promise<{ status: string; path: string }> {
  const res = await fetch(`${API_BASE}/create/folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo crear la carpeta '${path}'`)
  }
  return res.json()
}

export async function importGithub(url: string): Promise<{ status: string; path: string }> {
  const res = await fetch(`${API_BASE}/create/github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo importar el repositorio de GitHub: ${url}`)
  }
  return res.json()
}

export async function importArxiv(id: string): Promise<{ status: string; path: string }> {
  const res = await fetch(`${API_BASE}/create/arxiv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo importar el artículo de arXiv: ${id}`)
  }
  return res.json()
}

export async function importPubmed(id: string): Promise<{ status: string; path: string }> {
  const res = await fetch(`${API_BASE}/create/pubmed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo importar el artículo de PubMed: ${id}`)
  }
  return res.json()
}

export async function createSystemFile(): Promise<{ status: string; path: string }> {
  const res = await fetch(`${API_BASE}/create/system-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo seleccionar o importar el archivo del sistema`)
  }
  return res.json()
}

export async function createSystemFolder(): Promise<{ status: string; path: string }> {
  const res = await fetch(`${API_BASE}/create/system-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  if (!res.ok) {
    await handleResponseError(res, `No se pudo seleccionar o importar la carpeta del sistema`)
  }
  return res.json()
}