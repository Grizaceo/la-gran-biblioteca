// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import type { Node, Edge, Graph } from '../lib/bridge'
import { PALETTE } from './palette.js'

const ringGeoCache = new Map<string, THREE.RingGeometry>()
const ringMatCache = new Map<string, THREE.MeshBasicMaterial>()

function createNodeObject(node: { type: string; weight?: number }): THREE.Mesh {
  const size  = Math.cbrt(node.weight || 1) * 3
  const color = (PALETTE as Record<string, string>)[node.type] ?? PALETTE.default

  const geo  = new THREE.SphereGeometry(size, 16, 16)
  const mat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.85 })
  const mesh = new THREE.Mesh(geo, mat)

  const rKey = `${color}:${size.toFixed(2)}`
  let ringGeo = ringGeoCache.get(rKey)
  if (!ringGeo) {
    ringGeo = new THREE.RingGeometry(size * 0.8, size * 1.2, 32)
    ringGeoCache.set(rKey, ringGeo)
  }
  let ringMat = ringMatCache.get(color)
  if (!ringMat) {
    ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, transparent: true, opacity: 0.25 })
    ringMatCache.set(color, ringMat)
  }

  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.lookAt(new THREE.Vector3(0, 0, 1))
  mesh.add(ring)
  return mesh
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Graph3DEngine {
  fg: any
  onMinimapTick?: () => void

  private nodeIndex = new Map<string, Record<string, unknown>>()
  private starfield: THREE.Points

  constructor(container: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FG3D = ForceGraph3D as any
    this.fg = FG3D({ controlType: 'orbit', rendererConfig: { antialias: true, alpha: false } })(container)
      .nodeThreeObject(createNodeObject)
      .nodeThreeObjectExtend(true)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleWidth(1.2)
      .linkDirectionalArrowLength(6)
      .linkDirectionalArrowRelPos(0.95)
      .nodeRelSize(4)
      .nodeResolution(8)
      .linkResolution(4)
      .warmupTicks(120)
      .cooldownTicks(0)
      .backgroundColor('#000011')

    const scene = this.fg.scene()
    this.starfield = createStarfield(scene)
    scene.add(new THREE.AmbientLight(0x404060, 0.5))
    scene.add(new THREE.PointLight(0xffffff, 0.8, 1000))

    let minimapFrame = 0
    this.fg.onEngineTick(() => {
      this.starfield.rotation.y += 0.0001
      this.starfield.rotation.x += 0.00005
      if (++minimapFrame % 30 === 0) this.onMinimapTick?.()
    })
  }

  setGraph(g: Graph): void {
    this.nodeIndex.clear()
    const nodes = g.nodes.map(n => {
      const h = this.hydrate(n)
      this.nodeIndex.set(n.id, h)
      return h
    })
    this.fg.graphData({
      nodes,
      links: g.edges.map((e: Edge) => ({ source: e.source, target: e.target, type: e.type })),
    })
    setTimeout(() => this.fg.zoomToFit(1000, 40), 200)
  }

  applyUpdate(g: Graph): void {
    const nodes = g.nodes.map(n => {
      const fresh = this.hydrate(n)
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

  private hydrate(n: Node): Record<string, unknown> {
    const weight = ((n.metadata?.study_count as number | undefined) ?? 0) + 1
    return { ...n, name: n.label, weight }
  }

  destroy(): void {
    ringGeoCache.clear()
    ringMatCache.clear()
    ;(this.fg as unknown as { _destructor: () => void })._destructor()
  }
}
