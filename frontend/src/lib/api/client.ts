/** Base URL, API key, retries (WSL proxy fallback). */

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

export const API_DIRECT =
  (import.meta.env.VITE_API_DIRECT as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:3001/api'

export const API_KEY = import.meta.env.VITE_LGB_API_KEY as string | undefined

export const GRAPH_FETCH_MS = 120_000

export function joinApi(path: string, base: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY
  }
  return headers
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const bases =
    API_BASE === '/api' && import.meta.env.DEV ? [API_BASE, API_DIRECT] : [API_BASE]

  let lastErr: unknown
  for (const base of bases) {
    try {
      return await fetch(joinApi(path, base), init)
    } catch (err) {
      lastErr = err
      if (base !== bases[bases.length - 1]) continue
    }
  }
  const hint =
    lastErr instanceof TypeError
      ? ' (¿proxy caído? Reinicia: npm run dev en frontend/; backend en :3001)'
      : ''
  throw new Error(`${lastErr instanceof Error ? lastErr.message : String(lastErr)}${hint}`)
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    await handleResponseError(res, `Failed GET ${path}: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export function streamUrl(): string {
  return joinApi('/stream', API_BASE)
}

export async function handleResponseError(res: Response, fallbackMsg: string): Promise<never> {
  const data = await res.json().catch(() => null)
  if (data?.detail) {
    if (typeof data.detail === 'string') throw new Error(data.detail)
    if (Array.isArray(data.detail)) {
      throw new Error(data.detail.map((d: { msg?: string }) => d.msg).join(', '))
    }
  }
  throw new Error(fallbackMsg)
}
