// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import type { Node, Edge, Graph } from '../lib/bridge'
import { PALETTE } from './palette.js'

// Shared geometry buckets for raycasting/visual (keyed by rounded size)
const geoCache = new Map<number, THREE.SphereGeometry>()
// Shared materials per type — 1 draw call contribution per type
const matCache = new Map<string, THREE.MeshLambertMaterial>()

const PARTICLE_RADIUS = 280

function getGeo(size: number): THREE.SphereGeometry {
  const bucket = Math.max(1, Math.round(size))
  if (!geoCache.has(bucket)) {
    geoCache.set(bucket, new THREE.SphereGeometry(bucket, 10, 7))
  }
  return geoCache.get(bucket)!
}

function getMat(type: string): THREE.MeshLambertMaterial {
  if (!matCache.has(type)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    matCache.set(type, new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.88,
    }))
  }
  return matCache.get(type)!
}

function nodeSize(weight: number): number {
  return Math.min(Math.cbrt(weight || 1) * 3, 22)
}

function computeDegree(edges: Edge[]): Map<string, number> {
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) || 0) + 1)
    deg.set(e.target, (deg.get(e.target) || 0) + 1)
  }
  return deg
}

function createStarfield(scene: THREE.Scene, count = 2000): THREE.Points {
  const positions = new Float32Array(count * 3)
  const colors    = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi   = Math.acos(2 * Math.random() - 1)
    const r     = 700 + Math.random() * 100
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
    const b = 0.5 + Math.random() * 0.5
    colors[i * 3] = 0.8 * b; colors[i * 3 + 1] = 0.9 * b; colors[i * 3 + 2] = b
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.PointsMaterial({
    size: 1.5, vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: 0.8,
  })
  const starfield = new THREE.Points(geo, mat)
  scene.add(starfield)
  return starfield
}

function resolveType(endpoint: unknown): string {
  if (typeof endpoint === 'object' && endpoint !== null) {
    return ((endpoint as Record<string, unknown>).type as string) || 'default'
  }
  return 'default'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Graph3DEngine {
  fg: any
  onMinimapTick?: () => void
  onStop?: () => void
  onTypesChanged?: () => void

  private nodeIndex = new Map<string, Record<string, unknown>>()
  private starfield: THREE.Points
  private hiddenTypes = new Set<string>()
  private _zoomOnStop = false
  private _rafId = 0
  private _rafFrame = 0
  private _lastCamPos = new THREE.Vector3()

  constructor(container: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FG3D = ForceGraph3D as any
    this.fg = FG3D({ controlType: 'orbit', rendererConfig: { antialias: true, alpha: false } })(container)
      .nodeThreeObject((node: Record<string, unknown>) => {
        const size = nodeSize(node.weight as number)
        const type = (node.type as string) || 'default'
        return new THREE.Mesh(getGeo(size), getMat(type))
      })
      .nodeThreeObjectExtend(false)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleWidth(1.2)
      .linkDirectionalArrowLength(6)
      .linkDirectionalArrowRelPos(0.95)
      .linkResolution(4)
      .warmupTicks(120)
      .cooldownTicks(0)
      .backgroundColor('#000011')

    const scene = this.fg.scene()
    this.starfield = createStarfield(scene)
    scene.add(new THREE.AmbientLight(0x404060, 0.6))
    scene.add(new THREE.PointLight(0xffffff, 0.9, 1200))

    this.fg.onEngineStop(() => {
      if (this._zoomOnStop) {
        this.fg.zoomToFit(1000, 40)
        this._zoomOnStop = false
      }
      try { this.onStop?.() } catch (_) { /* */ }
      setTimeout(() => {
        try { this.onTypesChanged?.() } catch (_) { /* */ }
      }, 0)
    })

    let minimapFrame = 0
    this.fg.onEngineTick(() => {
      if (++minimapFrame % 30 === 0) this.onMinimapTick?.()
    })

    // rAF loop: starfield rotation + distance-based particle throttling.
    // Must never throw — wraps all logic in try/catch.
    const tick = () => {
      this._rafId = requestAnimationFrame(tick)
      try {
        this.starfield.rotation.y += 0.0001
        this.starfield.rotation.x += 0.00005
        if (++this._rafFrame % 6 === 0) this.updateParticleVisibility()
      } catch (_) { /* swallow — loop must survive */ }
    }
    this._rafId = requestAnimationFrame(tick)
  }

  private updateParticleVisibility(): void {
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

      const srcType = resolveType(link.source)
      const tgtType = resolveType(link.target)
      const typeVisible = !this.hiddenTypes.has(srcType) && !this.hiddenTypes.has(tgtType)

      // photons are stored internally by 3d-force-graph; access via __photonsObj if present
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const photons = (link as any).__photonsObj as THREE.Object3D | undefined
      if (photons) photons.visible = typeVisible && distSq < radiusSq
    }
  }

  private applyNodeVisibility(type: string, visible: boolean): void {
    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    for (const n of nodes) {
      const nType = (n.type as string) || 'default'
      if (nType !== type) continue
      const obj = n.__threeObj as THREE.Object3D | undefined
      if (obj) obj.visible = visible
    }
  }

  private applyEdgeVisibility(): void {
    const { links } = this.fg.graphData() as { links: Record<string, unknown>[] }
    for (const link of links) {
      const srcType = resolveType(link.source)
      const tgtType = resolveType(link.target)
      const visible = !this.hiddenTypes.has(srcType) && !this.hiddenTypes.has(tgtType)
      const lineObj  = link.__lineObj  as THREE.Object3D | undefined
      const arrowObj = link.__arrowObj as THREE.Object3D | undefined
      if (lineObj)  lineObj.visible  = visible
      if (arrowObj) arrowObj.visible = visible
    }
  }

  setTypeVisible(type: string, visible: boolean): void {
    if (visible) this.hiddenTypes.delete(type)
    else         this.hiddenTypes.add(type)
    this.applyNodeVisibility(type, visible)
    this.applyEdgeVisibility()
  }

  isTypeVisible(type: string): boolean {
    return !this.hiddenTypes.has(type)
  }

  getTypeStats(): Array<{ type: string; count: number; color: string }> {
    const counts = new Map<string, number>()
    for (const node of this.nodeIndex.values()) {
      const t = (node.type as string) || 'default'
      counts.set(t, (counts.get(t) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, count]) => ({
        type,
        count,
        color: (PALETTE as Record<string, string>)[type] ?? PALETTE.default,
      }))
  }

  setGraph(g: Graph): void {
    const degree = computeDegree(g.edges)
    this.nodeIndex.clear()
    const nodes = g.nodes.map(n => {
      const h = this.hydrate(n, degree.get(n.id) || 0)
      this.nodeIndex.set(n.id, h)
      return h
    })
    this._zoomOnStop = true
    this.fg.graphData({
      nodes,
      links: g.edges.map((e: Edge) => ({ source: e.source, target: e.target, type: e.type })),
    })
  }

  applyUpdate(g: Graph): void {
    const degree = computeDegree(g.edges)
    const nodes = g.nodes.map(n => {
      const fresh = this.hydrate(n, degree.get(n.id) || 0)
      const existing = this.nodeIndex.get(n.id)
      if (existing) {
        Object.assign(existing, fresh)
        return existing
      }
      this.nodeIndex.set(n.id, fresh)
      return fresh
    })

    const newIds = new Set(g.nodes.map(n => n.id))
    for (const id of this.nodeIndex.keys()) {
      if (!newIds.has(id)) this.nodeIndex.delete(id)
    }

    this.fg.graphData({
      nodes,
      links: g.edges.map((e: Edge) => ({ source: e.source, target: e.target, type: e.type })),
    })
  }

  onNodeClick(handler: (node: Record<string, unknown>) => void): void {
    this.fg.onNodeClick(handler)
  }

  onNodeHover(handler: (node: Record<string, unknown> | null) => void): void {
    this.fg.onNodeHover(handler)
  }

  private hydrate(n: Node, degree = 0): Record<string, unknown> {
    const studyCount = (n.metadata?.study_count as number | undefined) ?? 0
    const weight = 1 + studyCount * 0.3 + Math.sqrt(degree) * 1.5
    return { ...n, name: n.label, weight, degree }
  }

  destroy(): void {
    cancelAnimationFrame(this._rafId)
    geoCache.forEach(g => g.dispose())
    geoCache.clear()
    matCache.forEach(m => m.dispose())
    matCache.clear()
    ;(this.fg as unknown as { _destructor: () => void })._destructor()
  }
}
