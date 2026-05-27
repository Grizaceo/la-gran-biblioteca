import { PALETTE } from '../render3d/palette.js'

interface Engine {
  onNodeHover(cb: (node: Record<string, unknown> | null) => void): void
}

export function setupTooltip(
  engine: Engine,
  container: HTMLElement,
  onHover?: (node: Record<string, unknown> | null) => void,
): void {
  let el = document.getElementById('node-tooltip') as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = 'node-tooltip'
    document.body.appendChild(el)
  }
  const tooltip = el
  tooltip.setAttribute('role', 'tooltip')
  tooltip.setAttribute('aria-hidden', 'true')

  let mouseX = 0
  let mouseY = 0
  let isHovering = false

  function onMouseMove(e: MouseEvent): void {
    mouseX = e.clientX
    mouseY = e.clientY
    positionTooltip()
  }

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
      const name  = (node.name as string) || (node.id as string)
      const type  = (node.type as string) || 'unknown'
      const path  = (node.path as string) || ''
      const color = (PALETTE as Record<string, string>)[type] ?? (PALETTE as Record<string, string>).default
      const pathShort = path.length > 48 ? '…' + path.slice(-47) : path

      tooltip.innerHTML = ''

      const ttName = document.createElement('div')
      ttName.className = 'tt-name'
      ttName.textContent = name
      tooltip.appendChild(ttName)

      const ttType = document.createElement('div')
      ttType.className = 'tt-type'
      const dot = document.createElement('span')
      dot.className = 'tt-dot'
      dot.style.background = color
      const typeText = document.createTextNode(type)
      ttType.appendChild(dot)
      ttType.appendChild(typeText)
      tooltip.appendChild(ttType)

      if (pathShort) {
        const ttPath = document.createElement('div')
        ttPath.className = 'tt-path'
        ttPath.textContent = pathShort
        tooltip.appendChild(ttPath)
      }
      if (!isHovering) {
        document.addEventListener('mousemove', onMouseMove, { passive: true })
      }
      isHovering = true
      tooltip.classList.add('active')
      tooltip.setAttribute('aria-hidden', 'false')
      positionTooltip()
      container.style.cursor = 'pointer'
      onHover?.(node)
    } else {
      if (isHovering) {
        document.removeEventListener('mousemove', onMouseMove)
      }
      isHovering = false
      tooltip.classList.remove('active')
      tooltip.setAttribute('aria-hidden', 'true')
      container.style.cursor = 'grab'
      onHover?.(null)
    }
  })
}
