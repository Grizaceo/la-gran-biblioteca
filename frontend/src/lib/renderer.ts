// src/lib/renderer.ts - Canvas 2D renderer con zoom/pan

import * as d3Zoom from 'd3-zoom'
import { select } from 'd3-selection'
import { GraphEngine, PositionedNode } from './graphEngine'
import style from './style.json'

export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private engine: GraphEngine
  private zoom!: d3Zoom.ZoomBehavior<HTMLCanvasElement, unknown>
  private transform: { x: number; y: number; k: number } = { x: 0, y: 0, k: 1 }
  private tooltip: HTMLElement
  private onNodeDoubleClick?: (node: PositionedNode) => void
  
  constructor(canvas: HTMLCanvasElement, engine: GraphEngine) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.engine = engine
    this.tooltip = document.getElementById('tooltip')!
    
    this.setupZoom()
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }
  
  setOnNodeDoubleClick(cb: (node: PositionedNode) => void) {
    this.onNodeDoubleClick = cb
  }
  
  private setupZoom() {
    this.zoom = d3Zoom.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        this.transform = event.transform
        this.draw()
      })

    select(this.canvas).call(this.zoom)
  }
  
  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.canvas.width = rect.width
    this.canvas.height = rect.height
    this.draw()
  }
  
  render() {
    this.draw()
  }
  
  private draw() {
    const ctx = this.ctx
    const { x, y, k } = this.transform
    
    ctx.save()
    ctx.setTransform(k, 0, 0, k, x, y)
    ctx.clearRect(-x/k, -y/k, this.canvas.width/k, this.canvas.height/k)
    
    // Dibujar edges primero
    this.drawEdges(ctx)
    
    // Dibujar nodos
    this.drawNodes(ctx)
    
    ctx.restore()
  }
  
  private drawEdges(ctx: CanvasRenderingContext2D) {
    const edges = this.engine.getEdges()
    
    edges.forEach(edge => {
      const source = this.engine.getNode(edge.source)
      const target = this.engine.getNode(edge.target)
      
      if (!source?.position || !target?.position) return
      
      ctx.beginPath()
      ctx.moveTo(source.position.x, source.position.y)
      ctx.lineTo(target.position.x, target.position.y)
      
      ctx.strokeStyle = (style.edgeColor as Record<string, string>)[edge.type] || style.edgeColor.default
      ctx.lineWidth = 1
      ctx.stroke()
    })
  }
  
  private drawNodes(ctx: CanvasRenderingContext2D) {
    const nodes = this.engine.getNodes()
    
    nodes.forEach(node => {
      if (!node.position) return
      
      const x = node.position.x
      const y = node.position.y
      const r = this.engine.getNodeRadius(node)
      const color = this.engine.getNodeColor(node)
      
      // Sombra
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
      ctx.shadowBlur = 4
      
      // Nodo
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      
      // Borde
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.stroke()
      
      // Label pequeño
      ctx.shadowBlur = 0
      ctx.fillStyle = '#fff'
      ctx.font = '10px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(node.label.substring(0, 12), x, y + r + 12)
    })
  }
  
  handlePointerMove(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left - this.transform.x) / this.transform.k
    const my = (e.clientY - rect.top - this.transform.y) / this.transform.k
    
    // Buscar nodo bajo el mouse
    const node = this.engine.getNodes().find(n => {
      if (!n.position) return false
      const dx = mx - n.position.x
      const dy = my - n.position.y
      const r = this.engine.getNodeRadius(n)
      return dx * dx + dy * dy <= r * r
    })
    
    if (node) {
      this.tooltip.classList.remove('hidden')
      this.tooltip.style.left = `${e.clientX + 10}px`
      this.tooltip.style.top = `${e.clientY + 10}px`
      this.tooltip.innerHTML = `
        <strong>${node.label}</strong><br>
        <em>${node.type}</em><br>
        <small>${node.path}</small>
      `
    } else {
      this.tooltip.classList.add('hidden')
    }
  }
  
  handleDoubleClick(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left - this.transform.x) / this.transform.k
    const my = (e.clientY - rect.top - this.transform.y) / this.transform.k
    
    const node = this.engine.getNodes().find(n => {
      if (!n.position) return false
      const dx = mx - n.position.x
      const dy = my - n.position.y
      const r = this.engine.getNodeRadius(n)
      return dx * dx + dy * dy <= r * r
    })
    
    if (node && this.onNodeDoubleClick) {
      this.onNodeDoubleClick(node)
    }
  }
}