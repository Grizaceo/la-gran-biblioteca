const ESC_RE = /[&<>"']/g
const ESC_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(ESC_RE, (c) => ESC_MAP[c])
}
