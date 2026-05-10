// src/lib/bridge.ts - Fetch al backend + SSE para actualizaciones

const API_BASE = '/api'

export interface Node {
  id: string
  type: string
  label: string
  path: string
  metadata: Record<string, any>
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
}

export async function fetchGraph(): Promise<Graph> {
  const res = await fetch(`${API_BASE}/graph`)
  return res.json()
}

export async function fetchNode(id: string): Promise<Node> {
  const res = await fetch(`${API_BASE}/node/${id}`)
  return res.json()
}

export async function studyNode(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/study`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: id })
  })
  return res.json()
}

export function subscribeToUpdates(
  onUpdate: (graph: Graph) => void,
  onError?: (err: Error) => void
): () => void {
  const evtSource = new EventSource(`${API_BASE}/stream`)
  
  evtSource.addEventListener('init', (e: any) => {
    onUpdate(JSON.parse(e.data))
  })
  
  evtSource.addEventListener('update', (e: any) => {
    onUpdate(JSON.parse(e.data))
  })
  
  evtSource.onerror = (err) => {
    onError?.(err)
  }
  
  return () => evtSource.close()
}