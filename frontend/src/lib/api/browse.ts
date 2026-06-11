import { apiGet } from './client'
import type { BrowseResponse } from './types'

export async function browseDirectory(
  path?: string,
  includeFiles = true,
): Promise<BrowseResponse> {
  const params = new URLSearchParams()
  if (path) params.set('path', path)
  if (!includeFiles) params.set('include_files', 'false')
  const q = params.toString()
  return apiGet<BrowseResponse>(`/browse${q ? `?${q}` : ''}`)
}
