import * as THREE from 'three'
import type { ConstellationFigure, ConstellationFigureStar } from '../lib/api/types'

const ASTERISM_COLOR = new THREE.Color(0x8ab4f8)   // soft blue glow
const GUIDE_STAR_COLOR = new THREE.Color(0xffffff)  // white guide stars
const LABEL_FONT_SIZE = 14

// Returns an HTML canvas sprite for a constellation name label
function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 40
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 40)
  ctx.fillStyle = 'rgba(138, 180, 248, 0.85)'
  ctx.font = `${LABEL_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(text, 128, 26)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, opacity: 0.75 })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(80, 12, 1)
  return sprite
}

export function buildFiguresGroup(figures: ConstellationFigure[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'constellation-figures'

  for (const fig of figures) {
    if (!fig.stars?.length) continue

    // --- Asterism lines ---
    const linePoints: THREE.Vector3[] = []
    for (const [i, j] of fig.lines) {
      const a = fig.stars[i]
      const b = fig.stars[j]
      if (!a || !b) continue
      linePoints.push(new THREE.Vector3(a.x, a.y, a.z))
      linePoints.push(new THREE.Vector3(b.x, b.y, b.z))
    }
    if (linePoints.length) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints)
      const lineMat = new THREE.LineBasicMaterial({
        color: ASTERISM_COLOR,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      group.add(new THREE.LineSegments(lineGeo, lineMat))
    }

    // --- Guide stars (points sized by magnitude) ---
    const starPositions: number[] = []
    const starSizes: number[] = []
    for (const s of fig.stars) {
      starPositions.push(s.x, s.y, s.z)
      // Brighter star (lower mag) → larger point
      starSizes.push(Math.max(1.5, (5.5 - Math.min(s.mag, 5)) * 1.8))
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    starGeo.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1))
    const starMat = new THREE.PointsMaterial({
      color: GUIDE_STAR_COLOR,
      size: 3,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    group.add(new THREE.Points(starGeo, starMat))

    // --- Name label at centroid of stars ---
    const cx = fig.stars.reduce((s, v) => s + v.x, 0) / fig.stars.length
    const cy = fig.stars.reduce((s, v) => s + v.y, 0) / fig.stars.length
    const cz = fig.stars.reduce((s, v) => s + v.z, 0) / fig.stars.length
    const label = makeLabel(fig.name_es || fig.name)
    label.position.set(cx, cy + 18, cz)
    group.add(label)
  }

  return group
}

export function disposeFiguresGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
      obj.geometry.dispose()
      const mat = obj.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    }
    if (obj instanceof THREE.Sprite) {
      const mat = obj.material as THREE.SpriteMaterial
      mat.map?.dispose()
      mat.dispose()
    }
  })
}
