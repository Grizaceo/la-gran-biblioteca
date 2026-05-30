import * as THREE from 'three'
import type { Edge } from '../lib/bridge'
import type { HeatmapMode } from './viewPrefs'

export function nodeSize(weight: number): number {
  return Math.min(Math.cbrt(weight || 1) * 3, 22)
}

export function volumeNodeSize(degree: number, childCount: number): number {
  const hub = degree + childCount * 0.5
  return Math.min(4 + Math.sqrt(hub) * 2.2, 24)
}

export function studyNodeSize(base: number, studyCount: number): number {
  const boost = studyCount > 0 ? 1 + Math.min(studyCount, 8) * 0.15 : 1
  return Math.min(base * boost, 26)
}

export function heatmapStudyColor(score: number, maxScore: number): THREE.Color {
  const t = maxScore > 0 ? Math.min(1, score / maxScore) : 0
  const cold = new THREE.Color(0x4fc3f7)
  const warm = new THREE.Color(0xff7043)
  return cold.clone().lerp(warm, t)
}

export function heatmapVolumeColor(degree: number, maxDegree: number): THREE.Color {
  const t = maxDegree > 0 ? Math.min(1, degree / maxDegree) : 0
  const low = new THREE.Color(0x5c6bc0)
  const high = new THREE.Color(0xffee58)
  return low.clone().lerp(high, t)
}

export function computeDegree(edges: Edge[]): Map<string, number> {
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) || 0) + 1)
    deg.set(e.target, (deg.get(e.target) || 0) + 1)
  }
  return deg
}

export function nodeDisplaySize(
  node: Record<string, unknown>,
  heatmapMode: HeatmapMode,
): number {
  const meta = (node.metadata as Record<string, unknown>) || {}
  const degree = Number(node.degree) || Number(meta.degree_hint) || 0
  const childCount = Number(meta.child_count) || 0
  const studyCount = Number(meta.study_count) || 0
  let base = nodeSize(node.weight as number)
  if ((node.type as string) === 'note') {
    base *= 0.7
  }

  if (heatmapMode === 'volume') {
    return volumeNodeSize(degree, childCount)
  }
  if (heatmapMode === 'study') {
    return studyNodeSize(base, studyCount)
  }
  return base
}
