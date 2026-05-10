// src/main.ts - Entry point

import { fetchGraph, studyNode, subscribeToUpdates } from './lib/bridge'
import { GraphEngine } from './lib/graphEngine'
import { Renderer } from './lib/renderer'
import type { Graph } from './lib/bridge'

const canvas = document.getElementById('graph') as HTMLCanvasElement

const graphEngine = new GraphEngine(window.innerWidth, window.innerHeight)
const renderer = new Renderer(canvas, graphEngine)

// Event handlers
renderer.setOnNodeDoubleClick(async (node) => {
  await studyNode(node.id)
  console.log('Studied:', node.label)
})

canvas.addEventListener('pointermove', (e) => renderer.handlePointerMove(e))
canvas.addEventListener('dblclick', (e) => renderer.handleDoubleClick(e))

// Load and render
async function init() {
  try {
    const graph = await fetchGraph()
    graphEngine.loadGraph(graph)
    graphEngine.refineLayout(100)
    renderer.render()
  } catch (err) {
    console.error('Failed to load graph:', err)
  }
}

init()

// SSE cleanup on page unload
const closeSSE = subscribeToUpdates((graph: Graph) => {
  graphEngine.loadGraph(graph)
  graphEngine.refineLayout(30)
  renderer.render()
})

window.addEventListener('beforeunload', () => closeSSE())