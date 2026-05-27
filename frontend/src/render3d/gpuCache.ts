import * as THREE from 'three'
import { PALETTE } from './palette.js'

const sphereGeoCache = new Map<string, THREE.SphereGeometry>()
const ringGeoCache = new Map<string, THREE.RingGeometry>()
const lambertMatCache = new Map<string, THREE.MeshLambertMaterial>()
const basicMatCache = new Map<string, THREE.MeshBasicMaterial>()
const ringMatCache = new Map<string, THREE.MeshBasicMaterial>()

export function getSphereGeo(radius: number, segments: number): THREE.SphereGeometry {
  const bucketRadius = Math.max(0.5, Math.round(radius * 10) / 10)
  const key = `${bucketRadius.toFixed(1)}_${segments}`
  if (!sphereGeoCache.has(key)) {
    sphereGeoCache.set(key, new THREE.SphereGeometry(bucketRadius, segments, segments))
  }
  return sphereGeoCache.get(key)!
}

export function getRingGeo(inner: number, outer: number, segments: number): THREE.RingGeometry {
  const key = `${inner.toFixed(1)}_${outer.toFixed(1)}_${segments}`
  if (!ringGeoCache.has(key)) {
    ringGeoCache.set(key, new THREE.RingGeometry(inner, outer, segments))
  }
  return ringGeoCache.get(key)!
}

export function getLambertMat(type: string): THREE.MeshLambertMaterial {
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

export function getBasicMat(type: string): THREE.MeshBasicMaterial {
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

export function getLowBasicMat(type: string): THREE.MeshBasicMaterial {
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

export function getRingMat(type: string): THREE.MeshBasicMaterial {
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

export function disposeGpuCaches(): void {
  sphereGeoCache.forEach((g) => g.dispose())
  sphereGeoCache.clear()
  ringGeoCache.forEach((g) => g.dispose())
  ringGeoCache.clear()
  lambertMatCache.forEach((m) => m.dispose())
  lambertMatCache.clear()
  basicMatCache.forEach((m) => m.dispose())
  basicMatCache.clear()
  ringMatCache.forEach((m) => m.dispose())
  ringMatCache.clear()
}
