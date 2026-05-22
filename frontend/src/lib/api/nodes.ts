import { apiFetch, apiHeaders, handleResponseError } from './client'
import type { Node, NodeContent } from './types'

export async function fetchOverview(): Promise<import('./types').Overview> {
  const res = await apiFetch('/overview')
  if (!res.ok) throw new Error(`Failed to fetch overview: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchNode(id: string): Promise<Node> {
  const res = await apiFetch(`/node/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Failed to fetch node ${id}: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchNodeContent(id: string): Promise<NodeContent> {
  const res = await apiFetch(`/node/${encodeURIComponent(id)}/content`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function studyNode(id: string): Promise<unknown> {
  const res = await apiFetch('/study', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ node_id: id }),
  })
  if (!res.ok) throw new Error(`Failed to study node ${id}: ${res.status} ${res.statusText}`)
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
