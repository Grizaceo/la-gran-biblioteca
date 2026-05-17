// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import type { Node, Edge, Graph } from '../lib/bridge'
import { PALETTE } from './palette.js'

// Shared unit sphere for all InstancedMesh instances (1 draw call per type)
const baseInstanceGeo = new THREE.SphereGeometry(1, 8, 6)

// Low-poly spheres for raycasting only (invisible, shared by size bucket)
const raycastGeoCache = new Map<number, THREE.SphereGeometry>()
const raycastMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })

function getRaycastGeo(size: number): THREE.SphereGeometry {
  const bucket = Math.max(1, Math.round(size))
  let geo = raycastGeoCache.get(bucket)
  if (!geo) {
    geo = new THREE.SphereGeometry(bucket, 6, 4)
    raycastGeoCache.set(bucket, geo)
  }
  return geo
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Graph3DEngine {
  fg: any
  onMinimapTick?: () => void
  onStop?: () => void

  private nodeIndex = new Map<string, Record<string, unknown>>()
  private starfield: THREE.Points
  private instancedMeshes: THREE.InstancedMesh[] = []
  private _zoomOnStop = false

  constructor(container: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FG3D = ForceGraph3D as any
    this.fg = FG3D({ controlType: 'orbit', rendererConfig: { antialias: true, alpha: false } })(container)
      .nodeThreeObject((node: Record<string, unknown>) => {
        const size = nodeSize(node.weight as number)
        return new THREE.Mesh(getRaycastGeo(size), raycastMat)
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
      this.buildInstancedMeshes()
      if (this._zoomOnStop) {
        this.fg.zoomToFit(1000, 40)
        this._zoomOnStop = false
      }
      this.onStop?.()
    })

    let minimapFrame = 0
    this.fg.onEngineTick(() => {
      this.starfield.rotation.y += 0.0001
      this.starfield.rotation.x += 0.00005
      if (++minimapFrame % 30 === 0) this.onMinimapTick?.()
    })
  }

  private buildInstancedMeshes(): void {
    const scene = this.fg.scene()
    for (const m of this.instancedMeshes) {
      scene.remove(m)
      m.dispose()
    }
    this.instancedMeshes = []

    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    if (!nodes.length) return

    // Group by node type
    const byType = new Map<string, Record<string, unknown>[]>()
    for (const n of nodes) {
      const t = (n.type as string) || 'default'
      if (!byType.has(t)) byType.set(t, [])
      byType.get(t)!.push(n)
    }

    const dummy = new THREE.Object3D()

    for (const [type, typeNodes] of byType) {
      const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.15,
        transparent: true,
        opacity: 0.88,
      })
      const mesh = new THREE.InstancedMesh(baseInstanceGeo, mat, typeNodes.length)
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)

      for (let i = 0; i < typeNodes.length; i++) {
        const n = typeNodes[i]
        const size = nodeSize(n.weight as number)
        dummy.position.set((n.x as number) || 0, (n.y as number) || 0, (n.z as number) || 0)
        dummy.scale.setScalar(size)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      scene.add(mesh)
      this.instancedMeshes.push(mesh)
    }
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
    const scene = this.fg.scene()
    for (const m of this.instancedMeshes) {
      scene.remove(m)
      m.dispose()
    }
    this.instancedMeshes = []
    raycastGeoCache.forEach(g => g.dispose())
    raycastGeoCache.clear()
    ;(this.fg as unknown as { _destructor: () => void })._destructor()
  }
}
