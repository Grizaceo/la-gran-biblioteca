import * as THREE from 'three'
import type { Node, Graph } from '../lib/bridge'
import type { ConstellationFigure } from '../lib/api/types'
import { buildFiguresGroup, disposeFiguresGroup } from './constellationFigures'
import { applyLayoutForces, hydrateNodeForLayout } from './layoutMode'
import type { LayoutMode } from './viewPrefs'
import type { RenderProfile } from './renderOptimizations'

export class LayoutManager {
  layoutMode: LayoutMode
  private _figuresGroup: THREE.Group | null = null
  private _savedLinkStrength = 1
  private _savedChargeStrength = -60

  constructor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly fg: any,
    initialMode: LayoutMode,
  ) {
    this.layoutMode = initialMode
  }

  hydrateNodeForLayout(n: Node, degree = 0): Record<string, unknown> {
    return hydrateNodeForLayout(n, degree, this.layoutMode)
  }

  setLayoutMode(mode: LayoutMode): void {
    this.layoutMode = mode
    if (mode !== 'constellation') this.setConstellationFigures(null)
  }

  setConstellationFigures(figures: ConstellationFigure[] | null): void {
    const scene = this.fg.scene() as THREE.Scene
    if (this._figuresGroup) {
      scene.remove(this._figuresGroup)
      disposeFiguresGroup(this._figuresGroup)
      this._figuresGroup = null
    }
    if (figures?.length) {
      this._figuresGroup = buildFiguresGroup(figures)
      scene.add(this._figuresGroup)
    }
  }

  applyLayoutForces(profile: RenderProfile): void {
    const saved = applyLayoutForces(this.fg, this.layoutMode, profile, {
      linkStrength: this._savedLinkStrength,
      chargeStrength: this._savedChargeStrength,
    })
    this._savedLinkStrength = saved.linkStrength
    this._savedChargeStrength = saved.chargeStrength
  }

  getCurrentGraphSnapshot(): Graph | null {
    const { nodes, links } = this.fg.graphData() as {
      nodes: Record<string, unknown>[]
      links: Array<{ source: string | { id: string }; target: string | { id: string }; type?: string }>
    }
    if (!nodes?.length) return null
    const edges = links.map((l) => {
      const src = typeof l.source === 'object' ? l.source.id : l.source
      const tgt = typeof l.target === 'object' ? l.target.id : l.target
      return { source: src as string, target: tgt as string, type: (l.type as string) || 'default' }
    })
    const apiNodes = nodes.map((n) => {
      const meta = { ...(n.metadata as Record<string, unknown> || {}) }
      return {
        id: n.id as string,
        type: (n.type as string) || 'default',
        label: (n.label as string) || (n.name as string) || '',
        path: (n.path as string) || '',
        metadata: meta,
        position: {
          x: (n.x as number) || 0,
          y: (n.y as number) || 0,
          z: (n.z as number) || 0,
        },
      }
    }) as Node[]
    return { nodes: apiNodes, edges }
  }

  dispose(): void {
    this.setConstellationFigures(null)
  }
}
