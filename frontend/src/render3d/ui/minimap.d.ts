import type { Graph3DEngine } from '../Graph3DEngine'
import type { OverviewStructure } from '../../lib/bridge'

export interface MinimapHooks {
  showToast?: (msg: string, isError?: boolean) => void
  onFiltersChange?: () => void
}

export function initMinimap(
  forceGraph: unknown,
  engine?: Graph3DEngine | null,
  hooks?: MinimapHooks,
): {
  update: () => void
  invalidateBounds: () => void
  setStructure: (data: OverviewStructure | null) => void
  setMode: (mode: string) => void
}
