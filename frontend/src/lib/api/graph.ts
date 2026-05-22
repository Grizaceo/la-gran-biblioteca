import { apiFetch, GRAPH_FETCH_MS, streamUrl } from './client'
import type { Graph, GraphUpdateEvent } from './types'

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
