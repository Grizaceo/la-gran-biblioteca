export const QUICK_ACCESS_KEY = 'lgb.quickAccess'
export const SLOT_COUNT = 6

export type QuickAccessSlot = { nodeId: string; label: string; nodeType?: string } | null

export type QuickAccessNode = {
  id: string
  name?: string
  label?: string
  type?: string
}

function nodeLabel(node: QuickAccessNode): string {
  return node.name || node.label || node.id
}

function emptySlots(): QuickAccessSlot[] {
  return Array(SLOT_COUNT).fill(null) as QuickAccessSlot[]
}

export function loadSlots(): QuickAccessSlot[] {
  try {
    const raw = localStorage.getItem(QUICK_ACCESS_KEY)
    if (!raw) return emptySlots()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return emptySlots()
    const slots = emptySlots()
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = parsed[i]
      if (s && typeof s === 'object' && typeof (s as QuickAccessSlot)?.nodeId === 'string') {
        const slot = s as { nodeId: string; label?: string; nodeType?: string }
        slots[i] = {
          nodeId: slot.nodeId,
          label: String(slot.label || slot.nodeId),
          nodeType: slot.nodeType,
        }
      }
    }
    return slots
  } catch {
    return emptySlots()
  }
}

export function saveSlots(slots: QuickAccessSlot[]): void {
  localStorage.setItem(QUICK_ACCESS_KEY, JSON.stringify(slots.slice(0, SLOT_COUNT)))
}

export function assignSlot(index: number, node: QuickAccessNode): void {
  if (index < 0 || index >= SLOT_COUNT) return
  const slots = loadSlots()
  slots[index] = {
    nodeId: node.id,
    label: nodeLabel(node),
    nodeType: node.type,
  }
  saveSlots(slots)
}

export function clearSlot(index: number): void {
  if (index < 0 || index >= SLOT_COUNT) return
  const slots = loadSlots()
  slots[index] = null
  saveSlots(slots)
}

export function findSlotForNode(nodeId: string): number {
  return loadSlots().findIndex((s) => s?.nodeId === nodeId)
}

export function clearAllSlotsForNode(nodeId: string): void {
  const slots = loadSlots()
  let changed = false
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (slots[i]?.nodeId === nodeId) {
      slots[i] = null
      changed = true
    }
  }
  if (changed) saveSlots(slots)
}

export function isNodeInSlots(nodeId: string): boolean {
  return findSlotForNode(nodeId) >= 0
}
