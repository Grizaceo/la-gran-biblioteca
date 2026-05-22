import {
  deleteConstellationPref,
  fetchConstellationCatalog,
  fetchConstellationDetail,
  fetchConstellationPrefs,
  saveConstellationPref,
  triggerConstellationRelayout,
} from '../lib/api/constellation'
import type {
  ConstellationCatalogEntry,
  ConstellationDetail,
  ConstellationPref,
} from '../lib/api/types'

let catalogCache: ConstellationCatalogEntry[] | null = null

export async function loadCatalog(): Promise<ConstellationCatalogEntry[]> {
  if (!catalogCache) {
    const data = await fetchConstellationCatalog()
    catalogCache = data.constellations || []
  }
  return catalogCache
}

export function clearCatalogCache(): void {
  catalogCache = null
}

export function constellationLabel(id: string, catalog?: ConstellationCatalogEntry[]): Promise<string> {
  return loadCatalog().then((c) => {
    const hit = (catalog || c).find((x) => x.id === id)
    return hit ? (hit.name_es || hit.name) : id
  })
}

export async function loadPrefs(): Promise<{
  prefs: ConstellationPref[]
  pending: ConstellationPref[]
}> {
  return fetchConstellationPrefs()
}

const detailCache = new Map<string, ConstellationDetail>()

export async function loadConstellationDetail(id: string): Promise<ConstellationDetail> {
  const cached = detailCache.get(id)
  if (cached) return cached
  const detail = await fetchConstellationDetail(id)
  detailCache.set(id, detail)
  return detail
}

export async function confirmPref(
  folderPath: string,
  constellationId: string,
): Promise<{ status: string; pref: ConstellationPref }> {
  return saveConstellationPref(folderPath, constellationId, 'confirmed')
}

export async function removePref(folderPath: string): Promise<{ status: string }> {
  return deleteConstellationPref(folderPath)
}

export { triggerConstellationRelayout }
