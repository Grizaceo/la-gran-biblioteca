// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import type { Node, Edge, Graph } from '../lib/bridge'
import { PALETTE } from './palette.js'
import { getRenderProfile, createProgressiveLoader } from './renderOptimizations'

// Caches for GPU/Three.js resources to prevent duplicate allocation and memory thrashing
const sphereGeoCache = new Map<string, THREE.SphereGeometry>()
const ringGeoCache = new Map<string, THREE.RingGeometry>()
const lambertMatCache = new Map<string, THREE.MeshLambertMaterial>()
const basicMatCache = new Map<string, THREE.MeshBasicMaterial>()
const ringMatCache = new Map<string, THREE.MeshBasicMaterial>()

const PARTICLE_RADIUS = 280

function getSphereGeo(radius: number, segments: number): THREE.SphereGeometry {
  const bucketRadius = Math.max(0.5, Math.round(radius * 10) / 10)
  const key = `${bucketRadius.toFixed(1)}_${segments}`
  if (!sphereGeoCache.has(key)) {
    sphereGeoCache.set(key, new THREE.SphereGeometry(bucketRadius, segments, segments))
  }
  return sphereGeoCache.get(key)!
}

function getRingGeo(inner: number, outer: number, segments: number): THREE.RingGeometry {
  const key = `${inner.toFixed(1)}_${outer.toFixed(1)}_${segments}`
  if (!ringGeoCache.has(key)) {
    ringGeoCache.set(key, new THREE.RingGeometry(inner, outer, segments))
  }
  return ringGeoCache.get(key)!
}

function getLambertMat(type: string): THREE.MeshLambertMaterial {
  if (!lambertMatCache.has(type)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    lambertMatCache.set(type, new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.85,
    }))
  }
  return lambertMatCache.get(type)!
}

function getBasicMat(type: string): THREE.MeshBasicMaterial {
  if (!basicMatCache.has(type)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    basicMatCache.set(type, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.7,
    }))
  }
  return basicMatCache.get(type)!
}

function getLowBasicMat(type: string): THREE.MeshBasicMaterial {
  const key = `${type}_low`
  if (!basicMatCache.has(key)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    basicMatCache.set(key, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.45,
    }))
  }
  return basicMatCache.get(key)!
}

function getRingMat(type: string): THREE.MeshBasicMaterial {
  if (!ringMatCache.has(type)) {
    const color = (PALETTE as Record<string, string>)[type] ?? PALETTE.default
    ringMatCache.set(type, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
    }))
  }
  return ringMatCache.get(type)!
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

function createStarfield(scene: THREE.Scene, count = 800): THREE.Points {
  const starsGeo = new THREE.BufferGeometry()
  const starCount = count
  const positions = new Float32Array(starCount * 3)
  const colors = new Float32Array(starCount * 3)

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = 700 + Math.random() * 100

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)

    const brightness = 0.5 + Math.random() * 0.5
    colors[i * 3] = 0.8 * brightness
    colors[i * 3 + 1] = 0.9 * brightness
    colors[i * 3 + 2] = 1.0 * brightness
  }

  starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const starsMat = new THREE.PointsMaterial({
    size: 1.5,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.8,
  })

  const starfield = new THREE.Points(starsGeo, starsMat)
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
  private _paused = false
  private _savedParticles = 2
  private _tick!: () => void

  constructor(container: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FG3D = ForceGraph3D as any
    this.fg = FG3D({ controlType: 'orbit', rendererConfig: { antialias: true, alpha: false } })(container)
      .nodeThreeObject((node: Record<string, unknown>) => {
        const size = nodeSize(node.weight as number)
        const type = (node.type as string) || 'default'
        
        // Multi-level LOD Group representation
        const group = new THREE.Group()
        group.userData = { _lodDistance: size }

        // HI-LOD: Lambert lighting, 10 segments, glow ring
        const hiMesh = new THREE.Mesh(getSphereGeo(size, 10), getLambertMat(type))
        hiMesh.name = 'lod_hi'

        const ringGeo = getRingGeo(size - 0.5, size + 0.5, 24)
        const ring = new THREE.Mesh(ringGeo, getRingMat(type))
        ring.lookAt(new THREE.Vector3(0, 0, 1))
        ring.name = 'lod_ring'
        hiMesh.add(ring)
        group.add(hiMesh)

        // MID-LOD: Basic lighting (faster!), 7 segments, no ring
        const midMesh = new THREE.Mesh(getSphereGeo(size, 7), getBasicMat(type))
        midMesh.name = 'lod_mid'
        midMesh.visible = false
        group.add(midMesh)

        // LOW-LOD: Basic lighting, 4 segments, no ring
        const lowMesh = new THREE.Mesh(getSphereGeo(size, 4), getLowBasicMat(type))
        lowMesh.name = 'lod_low'
        lowMesh.visible = false
        group.add(lowMesh)

        return group
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

    // rAF loop: starfield rotation + throttled updates for LOD and link particles
    this._tick = () => {
      this._rafId = requestAnimationFrame(this._tick)
      try {
        this.starfield.rotation.y += 0.0001
        this.starfield.rotation.x += 0.00005
        
        // Throttled CPU tasks (run every 6 frames ~ 100ms)
        if (++this._rafFrame % 6 === 0) {
          this.updateParticleVisibility()
          this.updateLOD()
        }
      } catch (_) { /* swallow — loop must survive */ }
    }
    this._rafId = requestAnimationFrame(this._tick)
  }

  // Camera distance-driven level of detail selection (HI, MID, LOW meshes)
  private updateLOD(): void {
    const camera: THREE.Camera = this.fg.camera()
    if (!camera) return
    const camPos = camera.position

    const { nodes } = this.fg.graphData() as { nodes: Record<string, unknown>[] }
    if (!nodes?.length) return

    const _cameraPos = new THREE.Vector3().copy(camPos)
    const _nodePos = new THREE.Vector3()

    const LOD_NEAR = 150
    const LOD_MID = 400

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const obj = n.__threeObj as THREE.Group | undefined
      if (!obj || !obj.isGroup) continue

      _nodePos.set((n.x as number) || 0, (n.y as number) || 0, (n.z as number) || 0)
      const dist = _cameraPos.distanceTo(_nodePos)
      const size = (obj.userData._lodDistance as number) || 3
      const normDist = dist / Math.max(size, 1)

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

  pause(): void {
    if (this._paused) return
    this._paused = true
    cancelAnimationFrame(this._rafId)
    this._rafId = 0
    this.fg.pauseAnimation()
    this.fg.linkDirectionalParticles(0)
  }

  resume(): void {
    if (!this._paused) return
    this._paused = false
    this.fg.resumeAnimation()
    this.fg.linkDirectionalParticles(this._savedParticles)
    this._rafId = requestAnimationFrame(this._tick)
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
    
    const processedNodes = g.nodes.map(n => {
      const h = this.hydrate(n, degree.get(n.id) || 0)
      this.nodeIndex.set(n.id, h)
      return h
    })
    const processedLinks = g.edges.map((e: Edge) => ({ source: e.source, target: e.target, type: e.type }))

    const nodeCount = processedNodes.length
    const profile = getRenderProfile(nodeCount)

    // Apply adaptive render profile settings
    this.fg
      .antialias(profile.antialias)
      .warmupTicks(profile.warmupTicks)
      .cooldownTicks(profile.cooldownTicks)

    // Update adaptive starfield stars
    const scene = this.fg.scene()
    if (this.starfield) {
      scene.remove(this.starfield)
      this.starfield.geometry.dispose()
      if (Array.isArray(this.starfield.material)) {
        this.starfield.material.forEach(m => m.dispose())
      } else {
        this.starfield.material.dispose()
      }
    }
    this.starfield = createStarfield(scene, profile.starCount)

    this._zoomOnStop = true

    // Progressive loading via chunk-based streaming
    const loader = createProgressiveLoader({ nodes: processedNodes, links: processedLinks })
    let result = loader.append(profile.initialBatchSize)
    this.fg.graphData({ nodes: result.data.nodes, links: result.data.links })

    const pump = () => {
      if (this._paused) return
      if (result.done) return
      result = loader.append(profile.batchSize)
      this.fg.graphData({ nodes: result.data.nodes, links: result.data.links })
      setTimeout(pump, profile.chunkDelay)
    }
    
    if (!result.done) {
      setTimeout(pump, profile.chunkDelay)
    }
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

  onNodeRightClick(handler: (node: Record<string, unknown>, event: MouseEvent) => void): void {
    this.fg.onNodeRightClick(handler)
  }

  private hydrate(n: Node, degree = 0): Record<string, unknown> {
    const studyCount = (n.metadata?.study_count as number | undefined) ?? 0
    const weight = 1 + studyCount * 0.3 + Math.sqrt(degree) * 1.5
    return { ...n, name: n.label, weight, degree }
  }

  destroy(): void {
    cancelAnimationFrame(this._rafId)
    sphereGeoCache.forEach(g => g.dispose())
    sphereGeoCache.clear()
    ringGeoCache.forEach(g => g.dispose())
    ringGeoCache.clear()
    lambertMatCache.forEach(m => m.dispose())
    lambertMatCache.clear()
    basicMatCache.forEach(m => m.dispose())
    basicMatCache.clear()
    ringMatCache.forEach(m => m.dispose())
    ringMatCache.clear()
    ;(this.fg as unknown as { _destructor: () => void })._destructor()
  }
}
