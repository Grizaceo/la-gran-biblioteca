import { apiFetch, GRAPH_FETCH_MS, streamUrl } from './client'
import type { Graph, GraphUpdateEvent, OverviewStructure } from './types'

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

export async function fetchOverviewStructure(): Promise<OverviewStructure> {
  const res = await apiFetch('/graph/overview-structure')
  if (!res.ok) throw new Error(`Failed to fetch graph structure: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchSubgraph(params: {
  node_id: string
  depth?: number
  direction?: 'in' | 'out' | 'both'
  workspace?: string
  type?: string
  limit?: number
}): Promise<Graph> {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    qs.set(key, String(value))
  }
  const res = await apiFetch(`/graph/subgraph?${qs.toString()}`)
  if (!res.ok) throw new Error(`Failed to fetch subgraph: ${res.status} ${res.statusText}`)
  return res.json()
}

export function subscribeToUpdates(
  onUpdate: (graph: Graph, event: GraphUpdateEvent) => void,
  onError?: (err: Error) => void,
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
