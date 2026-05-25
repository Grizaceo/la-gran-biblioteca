import { apiFetch } from './client'
import type { ApplyLensResponse, ExplorationLens, SessionLensResponse } from '../lens'

export async function fetchLensCurrent(): Promise<SessionLensResponse> {
  const res = await apiFetch('/lens/current')
  if (!res.ok) throw new Error(`Failed to fetch lens: ${res.status}`)
  return res.json()
}

export async function publishLens(body: {
  lens: ExplorationLens
  focus_node_id?: string
  highlight_ids?: string[]
  updated_by?: string
}): Promise<SessionLensResponse> {
  const res = await apiFetch('/lens/current', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Failed to publish lens: ${res.status}`)
  return res.json()
}

export async function applyLensPreview(lens: ExplorationLens): Promise<ApplyLensResponse> {
  const res = await apiFetch('/lens/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lens }),
  })
  if (!res.ok) throw new Error(`Failed to apply lens: ${res.status}`)
  return res.json()
}
