import type { Node } from '../lib/bridge'
import type { LayoutMode } from './viewPrefs'
import type { RenderProfile } from './renderOptimizations'

export function hydrateNodeForLayout(
  n: Node,
  degree: number,
  layoutMode: LayoutMode,
): Record<string, unknown> {
  const studyCount = (n.metadata?.study_count as number | undefined) ?? 0
  let weight = 1 + studyCount * 0.3 + Math.sqrt(degree) * 1.5
  if (n.type === 'note') {
    weight *= 0.7
  }
  const h: Record<string, unknown> = { ...n, name: n.label, weight, degree }

  const meta = n.metadata || {}
  const p = n.position
  const orbitAnchor = meta.orbit_anchor as string | undefined

  // Note nodes with orbit_anchor: always fix position so they appear
  // near their source regardless of layout mode.
  if (n.type === 'note' && orbitAnchor && p != null
      && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number') {
    h.x = p.x
    h.y = p.y
    h.z = p.z
    h.fx = h.x
    h.fy = h.y
    h.fz = h.z
    return h
  }

  if (layoutMode !== 'constellation') {
    return h
  }

  const hasConstellationMeta = Boolean(meta.constellation_id)
  const hasValid3D =
    p != null
    && typeof p.x === 'number'
    && typeof p.y === 'number'
    && typeof p.z === 'number'
  if (hasConstellationMeta || hasValid3D) {
    h.x = p!.x
    h.y = p!.y
    h.z = p!.z
    h.fx = h.x
    h.fy = h.y
    h.fz = h.z
  }
  return h
}

export function applyLayoutForces(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fg: any,
  layoutMode: LayoutMode,
  profile: RenderProfile,
  saved: { linkStrength: number; chargeStrength: number },
): { linkStrength: number; chargeStrength: number } {
  const link = fg.d3Force?.('link')
  const charge = fg.d3Force?.('charge')
  if (layoutMode === 'constellation') {
    if (link?.strength) {
      saved.linkStrength = link.strength()
      link.strength(0)
    }
    if (charge?.strength) {
      saved.chargeStrength = charge.strength()
      charge.strength(0)
    }
    fg.warmupTicks(0).cooldownTicks(0)
  } else {
    const linkStrength = 0.5  // Weaker spring force for more spread
    const chargeStrength = -120  // Stronger repulsion
    if (link?.strength) link.strength(linkStrength)
    if (charge?.strength) charge.strength(chargeStrength)
    fg.warmupTicks(profile.warmupTicks).cooldownTicks(profile.cooldownTicks)
  }
  return saved
}
