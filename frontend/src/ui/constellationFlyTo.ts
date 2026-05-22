import type { Graph } from '../lib/bridge'

const CAMERA_ANIM_MS = 800

export function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '')
}

export function findFolderNodeId(graph: Graph | null, folderPath: string): string | null {
  if (!graph) return null
  const target = normalizeFolderPath(folderPath)
  const hit = graph.nodes.find(
    (n) => n.type === 'folder' && normalizeFolderPath(n.path || '') === target,
  )
  return hit?.id ?? null
}

/** Fly the 3D camera toward a node in the force-graph instance. */
export function flyCameraToNode(
  fg: {
    graphData(): { nodes: Array<Record<string, unknown>> }
    cameraPosition(
      to: { x: number; y: number; z: number },
      lookAt?: { x: number; y: number; z: number } | null,
      duration?: number,
    ): unknown
  },
  nodeId: string,
): boolean {
  const graphNode = fg.graphData().nodes.find((n) => n.id === nodeId)
  if (!graphNode) return false
  const nx = (graphNode.x as number) || 0
  const ny = (graphNode.y as number) || 0
  const nz = (graphNode.z as number) || 0
  const dist = 80
  const hyp = Math.hypot(nx, ny, nz) || 1
  const ratio = 1 + dist / hyp
  fg.cameraPosition(
    { x: nx * ratio, y: ny * ratio, z: nz * ratio },
    { x: nx, y: ny, z: nz },
    CAMERA_ANIM_MS,
  )
  return true
}
