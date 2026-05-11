// src/lib/graphEngine.ts - Layout con d3-force

import { Graph, Node, Edge } from './bridge'
import style from './style.json'

export interface PositionedNode extends Node {
  fx?: number | null
  fy?: number | null
  x?: number
  y?: number
}

export class GraphEngine {
  private nodes: PositionedNode[] = []
  private edges: Edge[] = []
  private width: number
  private height: number
  private worker: Worker
  public onUpdate?: () => void
  
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    // Instanciar el worker usando la URL de Vite
    this.worker = new Worker(new URL('./workers/graph.worker.ts', import.meta.url), { type: 'module' })
    
    this.worker.onmessage = (event) => {
      const { type, payload } = event.data
      if (type === 'TICK') {
        const positions = payload as {id: string, x: number, y: number}[]
        const nodeMap = new Map(this.nodes.map(n => [n.id, n]))
        for (const p of positions) {
          const n = nodeMap.get(p.id)
          if (n) {
            n.x = p.x
            n.y = p.y
            n.position = { x: p.x, y: p.y }
          }
        }
        if (this.onUpdate) this.onUpdate()
      }
    }
  }
  
  loadGraph(graph: Graph) {
    const oldNodeMap = new Map(this.nodes.map(n => [n.id, n]))
    this.nodes = graph.nodes.map(n => {
      const old = oldNodeMap.get(n.id)
      return { 
        ...n, 
        x: old?.x ?? n.position?.x, 
        y: old?.y ?? n.position?.y,
        vx: old?.vx,
        vy: old?.vy,
        position: old?.position ?? n.position
      }
    })
    this.edges = graph.edges
    
    this.worker.postMessage({
      type: 'START',
      payload: { nodes: this.nodes, edges: this.edges, width: this.width, height: this.height }
    })
  }
  
  getNode(id: string): PositionedNode | undefined {
    return this.nodes.find(n => n.id === id)
  }
  
  getNodes(): PositionedNode[] {
    return this.nodes
  }
  
  getEdges(): Edge[] {
    return this.edges
  }
  
  // refineLayout ya no es necesario sincronamente, el worker hace ticks
  refineLayout(iterations: number = 300) {
     // Obsoleto: ahora es manejado por el worker automáticamente al hacer loadGraph
  }
  
  getNodeRadius(node: PositionedNode | {type: string}): number {
    const n = node as PositionedNode
    return (style.nodeRadius as Record<string, number>)[n.type] || style.nodeRadius.default
  }

  getNodeColor(node: PositionedNode | {type: string}): string {
    const n = node as PositionedNode
    return (style.nodeColor as Record<string, string>)[n.type] || style.nodeColor.default
  }
}