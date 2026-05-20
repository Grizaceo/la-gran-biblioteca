import { Graph3DEngine } from '../../render3d/Graph3DEngine'
import { buildTooltipHTML } from './tooltipBuilder'

interface Engine {
  onNodeHover(cb: (node: Record<string, unknown> | null) => void): void
}

export function setupTooltip(
  engine: Engine,
  container: HTMLElement,
  onHover?: (node: Record<string, unknown> | null) => void,
): void {
  const tooltip = document.createElement('div')
  tooltip.id = 'node-tooltip'
  document.body.appendChild(tooltip)

  let mouseX = 0
  let mouseY = 0
  let isHovering = false

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX
    mouseY = e.clientY
    if (isHovering) positionTooltip()
  })

  function positionTooltip(): void {
    const tw = tooltip.offsetWidth
    const th = tooltip.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = mouseX + 16
    let y = mouseY - 12
    if (x + tw > vw - 8) x = mouseX - tw - 16
    if (y + th > vh - 8) y = vh - th - 8
    tooltip.style.left = x + 'px'
    tooltip.style.top  = y + 'px'
  }

  engine.onNodeHover((node) => {
    if (node) {
      tooltip.innerHTML = buildTooltipHTML(node)
      isHovering = true
      tooltip.classList.add('active')
      positionTooltip()
      container.style.cursor = 'pointer'
      onHover?.(node)
    } else {
      isHovering = false
      tooltip.classList.remove('active')
      container.style.cursor = 'grab'
      onHover?.(null)
    }
  })
}
