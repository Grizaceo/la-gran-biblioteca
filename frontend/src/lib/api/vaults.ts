import { apiFetch, apiGet, apiHeaders, handleResponseError } from './client'
import type { VaultInfo, VaultListResponse, VaultSwitchResponse } from './types'

export async function fetchVaults(): Promise<VaultListResponse> {
  return apiGet<VaultListResponse>('/vaults')
}

export async function registerVault(path: string, name?: string): Promise<VaultInfo> {
  const res = await apiFetch('/vaults', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, name: name ?? undefined }),
  })
  if (!res.ok) {
    await handleResponseError(res, `Failed to register vault: ${res.status}`)
  }
  return res.json() as Promise<VaultInfo>
}

export async function openVaultPicker(): Promise<VaultSwitchResponse> {
  const res = await apiFetch('/vaults/open', {
    method: 'POST',
    headers: apiHeaders(),
  })
  if (!res.ok) {
    await handleResponseError(res, `Failed to open vault: ${res.status}`)
  }
  return res.json() as Promise<VaultSwitchResponse>
}

export async function switchVault(id: string): Promise<VaultSwitchResponse> {
  const res = await apiFetch('/vaults/switch', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id }),
  })
  if (!res.ok) {
    await handleResponseError(res, `Failed to switch vault: ${res.status}`)
  }
  return res.json() as Promise<VaultSwitchResponse>
}

export async function switchVaultByPath(path: string): Promise<VaultSwitchResponse> {
  const res = await apiFetch('/vaults/switch', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path }),
  })
  if (!res.ok) {
    await handleResponseError(res, `Failed to switch vault: ${res.status}`)
  }
  return res.json() as Promise<VaultSwitchResponse>
}

export async function renameVault(id: string, name: string): Promise<VaultInfo> {
  const res = await apiFetch(`/vaults/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    await handleResponseError(res, `Failed to rename vault: ${res.status}`)
  }
  return res.json() as Promise<VaultInfo>
}

export async function removeVault(id: string): Promise<void> {
  const res = await apiFetch(`/vaults/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: apiHeaders(),
  })
  if (!res.ok) {
    await handleResponseError(res, `Failed to remove vault: ${res.status}`)
  }
}
