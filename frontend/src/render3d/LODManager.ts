import * as THREE from 'three'

export class LODManager {
  private _lodSegHi = 10
  private _lodSegMid = 7
  private _lodSegLow = 4
  private _lodNodeCount = 0
  private showLabels = false
  private readonly _lastLodCamPos = new THREE.Vector3()
  private readonly _lodCamPos = new THREE.Vector3()
  private readonly _lodNodePos = new THREE.Vector3()

  constructor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly fg: any,
  ) {}

  getLodSegHi(): number { return this._lodSegHi }
  getLodSegMid(): number { return this._lodSegMid }
  getLodSegLow(): number { return this._lodSegLow }
  getLodNodeCount(): number { return this._lodNodeCount }

  setLodSegments(hi: number, mid: number, low: number): void {
    this._lodSegHi = hi
    this._lodSegMid = mid
    this._lodSegLow = low
  }

  setLodNodeCount(count: number): void {
    this._lodNodeCount = count
  }

  setShowLabels(show: boolean): void {
    this.showLabels = show
    this.fg.nodeLabel((node: Record<string, unknown>) =>
      show ? String(node.name || node.label || node.id || '') : '')
  }

  getShowLabels(): boolean {
    return this.showLabels
  }

  updateLOD(): void {
    const camera: THREE.Camera = this.fg.camera()
    if (!camera) return
    const camPos = camera.position

    if (camPos.distanceToSquared(this._lastLodCamPos) < 1) return
    this._lastLodCamPos.copy(camPos)

    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    if (!nodes?.length) return

    this._lodCamPos.copy(camPos)

    const LOD_NEAR = 150
    const LOD_MID = 400
    const stride = this._lodNodeCount >= 400
      ? Math.max(1, Math.ceil(nodes.length / 200))
      : 1

    for (let i = 0; i < nodes.length; i += stride) {
      const n = nodes[i]
      const obj = n.__threeObj as THREE.Group | undefined
      if (!obj || !obj.isGroup) continue

      this._lodNodePos.set((n.x as number) || 0, (n.y as number) || 0, (n.z as number) || 0)
      const distSq = this._lodCamPos.distanceToSquared(this._lodNodePos)
      const size = Math.max((obj.userData._lodDistance as number) || 3, 1)
      const normDist = Math.sqrt(distSq) / size

      const hi = obj.getObjectByName('lod_hi')
      const mid = obj.getObjectByName('lod_mid')
      const low = obj.getObjectByName('lod_low')

      if (normDist < LOD_NEAR) {
        if (hi) hi.visible = true
        if (mid) mid.visible = false
        if (low) low.visible = false
      } else if (normDist < LOD_MID) {
        if (hi) hi.visible = false
        if (mid) mid.visible = true
        if (low) low.visible = false
      } else {
        if (hi) hi.visible = false
        if (mid) mid.visible = false
        if (low) low.visible = true
      }
    }
  }
}
