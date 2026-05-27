import * as THREE from 'three'
import type { StarfieldConfig } from './renderOptimizations'

export function createStarfield(scene: THREE.Scene, config: StarfieldConfig): THREE.Points {
  const { count, center, outerRadius, pointSize } = config
  const starsGeo = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = outerRadius * Math.cbrt(Math.random())

    positions[i * 3] = center.x + r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = center.y + r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = center.z + r * Math.cos(phi)

    const brightness = 0.45 + Math.random() * 0.55
    colors[i * 3] = 0.8 * brightness
    colors[i * 3 + 1] = 0.9 * brightness
    colors[i * 3 + 2] = 1.0 * brightness
  }

  starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const starsMat = new THREE.PointsMaterial({
    size: pointSize,
    sizeAttenuation: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.62,
  })

  const starfield = new THREE.Points(starsGeo, starsMat)
  scene.add(starfield)
  return starfield
}
