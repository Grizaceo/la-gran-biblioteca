import { apiFetch, apiHeaders, handleResponseError } from './client'
import type {
  ConstellationCatalogEntry,
  ConstellationDetail,
  ConstellationPref,
} from './types'

export async function fetchConstellationCatalog(): Promise<{
  constellations: ConstellationCatalogEntry[]
}> {
  const res = await apiFetch('/constellation/catalog')
  if (!res.ok) throw new Error(`Failed to fetch constellation catalog: ${res.status}`)
  return res.json()
}

export async function fetchConstellationDetail(id: string): Promise<ConstellationDetail> {
  const res = await apiFetch(`/constellation/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Failed to fetch constellation: ${res.status}`)
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

export async function triggerConstellationRelayout(): Promise<{
  status: string
  nodes: number
  edges: number
}> {
  const res = await apiFetch('/constellation/relayout', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo recalcular el layout')
  return res.json()
}
