import { PALETTE } from '../render3d/palette.js'
import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import {
  SLOT_COUNT,
  loadSlots,
  saveSlots,
  clearSlot,
  type QuickAccessSlot,
} from './quickAccess'

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

function slotColor(nodeType?: string): string {
  const t = nodeType || 'default'
  return (PALETTE as Record<string, string>)[t] ?? PALETTE.default
}

export function initQuickAccessBar(opts: {
  engine: Graph3DEngine
  showToast: (msg: string, isError?: boolean) => void
}): { render: () => void } {
  const { engine, showToast } = opts

  function activateSlot(index: number): void {
    const slot = loadSlots()[index]
    if (!slot) return
    if (engine.flyToNode(slot.nodeId)) {
      showToast(slot.label)
    } else {
      showToast(`No se encontró «${slot.label}» en el grafo visible.`, true)
    }
  }

  function renderSlotButton(index: number, slot: QuickAccessSlot): void {
    const btn = document.getElementById(`quick-slot-${index}`) as HTMLButtonElement | null
    if (!btn) return

    const dot = btn.querySelector('.qa-dot') as HTMLElement | null
    const labelEl = btn.querySelector('.qa-label') as HTMLElement | null

    if (slot) {
      btn.classList.remove('empty')
      btn.classList.add('filled')
      btn.title = `${slot.label} (${index + 1}) — clic: volar · clic derecho: quitar`
      if (labelEl) labelEl.textContent = slot.label
      if (dot) {
        dot.hidden = false
        dot.style.background = slotColor(slot.nodeType)
      }
      btn.setAttribute('aria-label', `Acceso ${index + 1}: ${slot.label}`)
    } else {
      btn.classList.add('empty')
      btn.classList.remove('filled')
      btn.title = `Acceso ${index + 1} vacío — asigna desde clic derecho en un nodo`
      if (labelEl) labelEl.textContent = ''
      if (dot) dot.hidden = true
      btn.setAttribute('aria-label', `Acceso ${index + 1} vacío`)
    }
  }

  function render(): void {
    const slots = loadSlots()
    for (let i = 0; i < SLOT_COUNT; i++) {
      renderSlotButton(i, slots[i])
    }
  }

  for (let i = 0; i < SLOT_COUNT; i++) {
    const btn = document.getElementById(`quick-slot-${i}`) as HTMLButtonElement | null
    if (!btn) continue

    btn.addEventListener('click', (e) => {
      if ((e as MouseEvent).button !== 0) return
      e.preventDefault()
      activateSlot(i)
    })

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (!loadSlots()[i]) return
      clearSlot(i)
      render()
      showToast(`Acceso ${i + 1} liberado`)
    })
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (isTypingTarget(e.target)) return
    if (e.key < '1' || e.key > '6') return
    const index = parseInt(e.key, 10) - 1
    if (!loadSlots()[index]) return
    e.preventDefault()
    activateSlot(index)
  })

  render()
  return { render }
}

export function refreshQuickAccessLabels(engine: Graph3DEngine): boolean {
  const slots = loadSlots()
  const { nodes } = engine.fg.graphData() as { nodes: Record<string, unknown>[] }
  const byId = new Map(nodes.map((n) => [String(n.id), n]))
  let changed = false

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = slots[i]
    if (!slot) continue
    const node = byId.get(slot.nodeId)
    if (!node) continue
    const label = String(node.name || node.label || node.id)
    const nodeType = String(node.type || slot.nodeType || '')
    if (label !== slot.label || nodeType !== (slot.nodeType || '')) {
      slots[i] = { ...slot, label, nodeType: nodeType || slot.nodeType }
      changed = true
    }
  }

  if (changed) saveSlots(slots)
  return changed
}
