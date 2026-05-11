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
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')
    this.ctx = ctx
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
    const { x, y, k } = this.transform
    
    const viewLeft = -x / k
    const viewRight = (this.canvas.width - x) / k
    const viewTop = -y / k
    const viewBottom = (this.canvas.height - y) / k
    
    edges.forEach(edge => {
      const source = this.engine.getNode(edge.source)
      const target = this.engine.getNode(edge.target)
      
      if (!source?.position || !target?.position) return
      
      // CULLING Básico
      const sx = source.position.x
      const sy = source.position.y
      const tx = target.position.x
      const ty = target.position.y
      
      if ((sx < viewLeft && tx < viewLeft) || 
          (sx > viewRight && tx > viewRight) || 
          (sy < viewTop && ty < viewTop) || 
          (sy > viewBottom && ty > viewBottom)) {
        return
      }
      
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(tx, ty)
      
      ctx.strokeStyle = (style.edgeColor as Record<string, string>)[edge.type] || style.edgeColor.default
      ctx.lineWidth = 1
      ctx.stroke()
    })
  }
  
  private drawNodes(ctx: CanvasRenderingContext2D) {
    const nodes = this.engine.getNodes()
    const { x, y, k } = this.transform
    
    const viewLeft = -x / k
    const viewRight = (this.canvas.width - x) / k
    const viewTop = -y / k
    const viewBottom = (this.canvas.height - y) / k

    const isLargeGraph = nodes.length > 1000
    const isMassiveGraph = nodes.length > 3000
    
    nodes.forEach(node => {
      if (!node.position) return
      
      const nx = node.position.x
      const ny = node.position.y
      const r = this.engine.getNodeRadius(node)
      
      // CULLING
      if (nx + r < viewLeft || nx - r > viewRight || ny + r < viewTop || ny - r > viewBottom) {
        return
      }
      
      const color = this.engine.getNodeColor(node)
      
      // Sombra (LOD)
      if (!isMassiveGraph) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
        ctx.shadowBlur = 4
      } else {
        ctx.shadowBlur = 0
      }
      
      // Nodo
      ctx.beginPath()
      ctx.arc(nx, ny, isMassiveGraph ? r * 0.7 : r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      
      // Borde
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.stroke()
      
      // Label pequeño (LOD)
      if (!isLargeGraph || k > 1.5) {
        ctx.shadowBlur = 0
        ctx.fillStyle = '#fff'
        ctx.font = '10px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(node.label.substring(0, 12), nx, ny + r + 12)
      }
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