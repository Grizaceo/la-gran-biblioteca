// src/lib/graphEngine.ts - Layout con d3-force

import * as d3Force from 'd3-force'
import { Graph, Node, Edge } from './bridge'

export interface PositionedNode extends Node {
  fx?: number | null
  fy?: number | null
}

export class GraphEngine {
  private nodes: PositionedNode[] = []
  private edges: Edge[] = []
  private width: number
  private height: number
  
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  
  loadGraph(graph: Graph) {
    this.nodes = graph.nodes.map(n => ({ ...n }))
    this.edges = graph.edges
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
  
  refineLayout(iterations: number = 300) {
    // Crear simulación d3-force
    const simulation = d3Force.forceSimulation(this.nodes)
      .force('charge', d3Force.forceManyBody().strength(-300))
      .force('center', d3Force.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3Force.forceCollide().radius(this.getNodeRadius.bind(this)))
      .force('link', d3Force.forceLink(this.edges)
        .id((d: any) => d.id)
        .distance(100)
        .strength(0.5))
      .stop()
    
    // Ejecutar iteraciones
    for (let i = 0; i < iterations; i++) {
      simulation.tick()
    }
    
    // Actualizar posiciones
    this.nodes.forEach(n => {
      if (n.position) {
        n.position.x = n.x ?? n.position.x
        n.position.y = n.y ?? n.position.y
      }
    })
  }
  
  getNodeRadius(node: PositionedNode): number {
    const typeSizes: Record<string, number> = {
      folder: 20,
      document: 15,
      paper: 18,
      script: 12,
      config: 10,
      index: 22
    }
    return typeSizes[node.type] || 12
  }
  
  getNodeColor(node: PositionedNode): string {
    const typeColors: Record<string, string> = {
      folder: '#4A90E2',
      document: '#7ED321',
      paper: '#D0021B',
      script: '#F5A623',
      config: '#9013FE',
      index: '#50E3C2',
      default: '#BDC3C7'
    }
    return typeColors[node.type] || typeColors.default
  }
}