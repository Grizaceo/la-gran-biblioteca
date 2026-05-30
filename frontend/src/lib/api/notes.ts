import { apiFetch, apiHeaders, handleResponseError } from './client'
import type { CreateNoteRequest, Note, NoteListResponse } from './types'

export async function createNote(req: CreateNoteRequest): Promise<Note> {
  const res = await apiFetch('/notes', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(req),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo crear la nota')
  return res.json()
}

export async function getNote(noteId: string): Promise<Note> {
  const res = await apiFetch(`/notes/${encodeURIComponent(noteId)}`)
  if (!res.ok) await handleResponseError(res, 'No se pudo leer la nota')
  return res.json()
}

export async function updateNote(
  noteId: string,
  patch: Partial<Pick<Note, 'title' | 'body' | 'labels'>>,
): Promise<Note> {
  const res = await apiFetch(`/notes/${encodeURIComponent(noteId)}`, {
    method: 'PATCH',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo actualizar la nota')
  return res.json()
}

export async function deleteNote(noteId: string): Promise<{ status: string; id: string }> {
  const res = await apiFetch(`/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    headers: apiHeaders(),
  })
  if (!res.ok) await handleResponseError(res, 'No se pudo borrar la nota')
  return res.json()
}

export async function getNotesForSource(sourceId: string): Promise<NoteListResponse> {
  const qs = new URLSearchParams({ source: sourceId })
  const res = await apiFetch(`/notes?${qs}`)
  if (!res.ok) await handleResponseError(res, 'No se pudieron listar las notas')
  return res.json()
}
