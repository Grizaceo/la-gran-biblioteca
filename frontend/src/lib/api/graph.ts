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

const SSE_MAX_DELAY_MS = 30_000

export function subscribeToUpdates(
  onUpdate: (graph: Graph, event: GraphUpdateEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  let evtSource: EventSource | null = null
  let retryDelay = 1000
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function connect(): void {
    evtSource = new EventSource(streamUrl())

    evtSource.addEventListener('init', (e: MessageEvent) => {
      retryDelay = 1000
      onUpdate(JSON.parse(e.data), 'init')
    })
    evtSource.addEventListener('update', (e: MessageEvent) => {
      retryDelay = 1000
      onUpdate(JSON.parse(e.data), 'update')
    })
    evtSource.onerror = () => {
      evtSource?.close()
      evtSource = null
      onError?.(new Error('SSE connection error'))
      if (!stopped) {
        retryTimer = setTimeout(() => {
          if (!stopped) connect()
        }, retryDelay)
        retryDelay = Math.min(retryDelay * 2, SSE_MAX_DELAY_MS)
      }
    }
  }

  connect()

  return () => {
    stopped = true
    if (retryTimer) clearTimeout(retryTimer)
    evtSource?.close()
  }
}
