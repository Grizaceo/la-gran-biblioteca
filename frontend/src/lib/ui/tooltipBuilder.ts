import { PALETTE } from '../../render3d/palette.js';

const HTML_ESCAPE_RE = /[&<>\"']/g;
const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function escapeHtml(str: string | null | undefined): string {
  return String(str ?? '').replace(HTML_ESCAPE_RE, (ch) => {
    // ch is one of & < > " '
    return (HTML_ESCAPE_MAP as Record<string, string>)[ch] ?? ch;
  });
}

export function buildTooltipHTML(node: Record<string, unknown> | null): string {
  if (!node) return '';
  const parts: string[] = [];

  // Title
  const name = escapeHtml((node.name as string) ?? (node.id as string) ?? '');
  parts.push(`<div class="tt-title">${name}</div>`);

  // Type row
  const type = (node.type as string) ?? 'unknown';
  const typeColor = (PALETTE as Record<string, string>)[type] ?? (PALETTE as Record<string, string>).default;
  const corpusLabel = (node.corpus as string) ?? (node.nodeCategory as string) ?? type ?? '';
  const typeBadge = `<span class="tt-badge" style="background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44">${escapeHtml(type)}</span>`;
  const corpusSpan = corpusLabel ? `<span class="tt-corpus">${escapeHtml(corpusLabel)}</span>` : '';
  parts.push(`<div class="tt-row">${typeBadge}${corpusSpan}</div>`);

  // Citation count
  if (node.citationCount !== undefined) {
    parts.push(`<div class="tt-row"><span class="tt-label">Citaciones:</span> <span class="tt-value">${node.citationCount}</span></div>`);
  }

  // Weight
  if (node.weight !== undefined) {
    const weightVal = typeof node.weight === 'number' ? (node.weight as number).toFixed(2) : node.weight;
    parts.push(`<div class="tt-row"><span class="tt-label">Peso:</span> <span class="tt-value">${escapeHtml(String(weightVal))}</span></div>`);
  }

  // Confidence
  if (node.confidence !== undefined) {
    const confidenceVal = ((node.confidence as number) * 100).toFixed(0);
    parts.push(`<div class="tt-row"><span class="tt-label">Confianza:</span> <span class="tt-value">${confidenceVal}%</span></div>`);
  }

  // Community
  if (node.community) {
    const commColor = (node.communityColor as string) ?? '#90a4ae';
    parts.push(`<div class="tt-row"><span class="tt-label">Comunidad:</span> <span class="tt-comm" style="color:${commColor}">● ${escapeHtml(String(node.community))}</span></div>`);
  }

  return parts.join('');
}
