import type { Graph3DEngine } from '../Graph3DEngine'

export function initSearch(
  forceGraph: unknown,
  engine?: Graph3DEngine | null,
): {
  setup: (nodes: unknown[]) => void
  focusNode: (id: string) => void
  setTab: (tab: string) => void
  resetSearch: () => void
}
