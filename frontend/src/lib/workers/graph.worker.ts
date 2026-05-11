import * as d3Force from 'd3-force'
import style from '../style.json'

interface PositionedNode {
  id: string
  type: string
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface Edge {
  source: string
  target: string
  type: string
}

let simulation: d3Force.Simulation<PositionedNode, Edge> | null = null

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data

  if (type === 'START') {
    const { nodes, edges, width, height } = payload

    const getNodeRadius = (n: PositionedNode) => {
        return (style.nodeRadius as Record<string, number>)[n.type] || style.nodeRadius.default
    }

    if (simulation) {
      simulation.stop()
    }

    // Si todos los nodos tienen posiciones válidas, solo hacer refinamiento suave
    const allHavePositions = nodes.every((n: PositionedNode) => n.x != null && n.y != null)
    
    simulation = d3Force.forceSimulation(nodes)
      .force('charge', d3Force.forceManyBody().strength(-300))
      .force('center', d3Force.forceCenter(width / 2, height / 2))
      .force('collision', d3Force.forceCollide().radius(getNodeRadius))
      .force('link', d3Force.forceLink(edges).id((d: any) => d.id).distance(100).strength(0.5))
      .on('tick', () => {
        const positions = nodes.map((n: PositionedNode) => ({ id: n.id, x: n.x, y: n.y }))
        self.postMessage({ type: 'TICK', payload: positions })
      })
      .on('end', () => {
        self.postMessage({ type: 'END' })
      })

    // Si ya tienen posiciones, solo 5 iteraciones de refinamiento
    if (allHavePositions) {
      simulation.alphaDecay(0.9)  // Termina rápido
      simulation.alpha(0.1)       // Empezar con poca energía
    } else {
      // Calcular desde cero
      simulation.alphaDecay(0.05)
    }
    
    // Enviar primera posición inmediata si ya vienen calculadas
    if (allHavePositions) {
      const positions = nodes.map((n: PositionedNode) => ({ id: n.id, x: n.x, y: n.y }))
      self.postMessage({ type: 'TICK', payload: positions })
    }
  } else if (type === 'STOP') {
    if (simulation) simulation.stop()
  }
}