import { apiFetch, apiHeaders, handleResponseError } from './client'
import type { ArxivSearchResponse, ImportNoteResponse } from './types'

export async function createFile(
  path: string,
  content: string = '',
): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/file', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content }),
  })
  if (!res.ok) await handleResponseError(res, `No se pudo crear el archivo '${path}'`)
  return res.json()
}

export async function createFolder(path: string): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/folder', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path }),
  })
  if (!res.ok) await handleResponseError(res, `No se pudo crear la carpeta '${path}'`)
  return res.json()
}

export async function importGithub(url: string): Promise<ImportNoteResponse> {
  const res = await apiFetch('/create/github', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url }),
  })
  if (!res.ok) await handleResponseError(res, `No se pudo importar el repositorio de GitHub: ${url}`)
  return res.json()
}

export async function searchArxiv(params: {
  q?: string
  author?: string
  cat?: string
  max?: number
  sort?: 'relevance' | 'date'
}): Promise<ArxivSearchResponse> {
  const sp = new URLSearchParams()
  if (params.q?.trim()) sp.set('q', params.q.trim())
  if (params.author?.trim()) sp.set('author', params.author.trim())
  if (params.cat?.trim()) sp.set('cat', params.cat.trim())
  if (params.max != null) sp.set('max', String(params.max))
  if (params.sort) sp.set('sort', params.sort)
  const qs = sp.toString()
  const res = await apiFetch(`/arxiv/search${qs ? `?${qs}` : ''}`)
  if (!res.ok) await handleResponseError(res, 'No se pudo buscar en arXiv')
  return res.json()
}

export async function importArxiv(id: string): Promise<ImportNoteResponse> {
  const res = await apiFetch('/create/arxiv', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id }),
  })
  if (!res.ok) await handleResponseError(res, `No se pudo importar el artículo de arXiv: ${id}`)
  return res.json()
}

export async function importPubmed(id: string): Promise<ImportNoteResponse> {
  const res = await apiFetch('/create/pubmed', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id }),
  })
  if (!res.ok) await handleResponseError(res, `No se pudo importar el artículo de PubMed: ${id}`)
  return res.json()
}

export async function importFileFromPath(path: string): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/import-file-path', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo importar el archivo')
  return res.json()
}

export async function importFolderFromPath(
  path: string,
): Promise<{ status: string; path: string; node_id?: string; workspace_root?: string }> {
  const res = await apiFetch('/create/import-folder-path', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo importar la carpeta')
  return res.json()
}

export async function createSystemFile(): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/system-file', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo seleccionar o importar el archivo del sistema')
  return res.json()
}

export async function createSystemFolder(): Promise<{ status: string; path: string }> {
  const res = await apiFetch('/create/system-folder', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo seleccionar o importar la carpeta del sistema')
  return res.json()
}
