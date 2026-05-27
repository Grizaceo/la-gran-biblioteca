import * as THREE from 'three'
import type { Graph3DEngineHost } from './graph3dHost'

export const PARTICLE_RADIUS = 280

export class ParticleManager {
  photonsEnabled = true
  private readonly _lastCamPos = new THREE.Vector3()

  constructor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly fg: any,
    private readonly host: Graph3DEngineHost,
  ) {}

  updateParticleVisibility(): void {
    const camera: THREE.Camera = this.fg.camera()
    if (!camera) return
    const camPos = camera.position

    if (camPos.distanceToSquared(this._lastCamPos) < 1) return
    this._lastCamPos.copy(camPos)

    const radiusSq = PARTICLE_RADIUS * PARTICLE_RADIUS
    const { links } = this.fg.graphData() as { links: Record<string, unknown>[] }
    if (!links?.length) return

    for (const link of links) {
      const src = link.source as Record<string, unknown>
      const tgt = link.target as Record<string, unknown>
      if (!src || !tgt || typeof src !== 'object' || typeof tgt !== 'object') continue

      const mx = (((src.x as number) || 0) + ((tgt.x as number) || 0)) / 2
      const my = (((src.y as number) || 0) + ((tgt.y as number) || 0)) / 2
      const mz = (((src.z as number) || 0) + ((tgt.z as number) || 0)) / 2
      const dx = mx - camPos.x
      const dy = my - camPos.y
      const dz = mz - camPos.z
      const distSq = dx * dx + dy * dy + dz * dz

      const linkVisible =
        this.host.isLinkGraphVisible(link) && link.__filterVisible !== false

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const photons = (link as any).__photonsObj as THREE.Object3D | undefined
      if (photons) {
        photons.visible = Boolean(
          this.photonsEnabled && linkVisible && distSq < radiusSq,
        )
      }
    }
  }

  setPhotonsEnabled(enabled: boolean, paused: boolean): number {
    this.photonsEnabled = enabled
    const count = enabled ? 2 : 0
    if (!paused) {
      this.fg.linkDirectionalParticles(count)
    }
    return count
  }

  applyParticles(count: number): void {
    this.fg.linkDirectionalParticles(count)
  }
}
