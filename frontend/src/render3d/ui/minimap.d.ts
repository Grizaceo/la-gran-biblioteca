import type { Graph3DEngine } from '../Graph3DEngine'

export function initMinimap(
  forceGraph: unknown,
  engine?: Graph3DEngine | null,
): {
  update: () => void
  invalidateBounds: () => void
}
