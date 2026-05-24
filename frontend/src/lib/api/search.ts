import { apiFetch } from './client'
import type { SearchResponse } from './types'

export interface SearchParams {
  q?: string
  workspace?: string
  topic?: string
  folder_prefix?: string
  type?: string
  min_degree?: number
  studied?: 'all' | 'studied' | 'unstudied'
  is_import?: string
  mode?: 'text' | 'related' | 'hub'
  limit?: number
  offset?: number
}

export async function fetchSearch(params: SearchParams = {}): Promise<SearchResponse> {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    qs.set(key, String(value))
  }
  const res = await apiFetch(`/search?${qs.toString()}`)
  if (!res.ok) throw new Error(`Failed to search graph: ${res.status} ${res.statusText}`)
  return res.json()
}
