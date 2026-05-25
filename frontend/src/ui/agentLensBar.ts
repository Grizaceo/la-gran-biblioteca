import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import {
  fetchLensCurrent,
  type ExplorationLens,
  type SessionLensResponse,
  lensToGraphFilters,
} from '../lib/bridge'
import { saveHeatmapMode } from '../render3d/viewPrefs'

const POLL_MS = 2000
const STORAGE_AUTO = 'lgb.agentLensAutoApply'

export interface AgentLensBarHooks {
  engine: Graph3DEngine
  showToast: (msg: string, isError?: boolean) => void
  selectNode?: (id: string, delay?: number) => Promise<void>
  enterAgentFocus?: (nodeId: string, depth: number) => void
}

export function initAgentLensBar(hooks: AgentLensBarHooks): { destroy: () => void } {
  const bar = document.getElementById('agent-lens-bar')
  if (!bar) return { destroy: () => {} }

  const labelEl = document.getElementById('agent-lens-label')
  const metaEl = document.getElementById('agent-lens-meta')
  const btnApply = document.getElementById('agent-lens-apply') as HTMLButtonElement | null
  const btnDismiss = document.getElementById('agent-lens-dismiss') as HTMLButtonElement | null
  const btnCopy = document.getElementById('agent-lens-copy') as HTMLButtonElement | null

  let lastUpdatedAt: string | null = null
  let pending: SessionLensResponse | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function autoApplyEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_AUTO) === '1'
    } catch {
      return false
    }
  }

  function render(session: SessionLensResponse): void {
    const lens = session.lens
    if (!lens) {
      bar.classList.remove('active')
      pending = null
      return
    }

    bar.classList.add('active')
    pending = session
    if (labelEl) {
      labelEl.textContent = lens.label || lens.id || 'Vista del agente'
    }
    if (metaEl) {
      const parts = [
        lens.heatmap && lens.heatmap !== 'off' ? `heatmap:${lens.heatmap}` : null,
        lens.workspaces?.length ? lens.workspaces.join(', ') : null,
        lens.focusNodeId ? `foco:${lens.focusNodeId.split('/').pop()}` : null,
        session.updated_by ? `por ${session.updated_by}` : null,
        session.updated_at ? new Date(session.updated_at).toLocaleTimeString() : null,
      ].filter(Boolean)
      metaEl.textContent = parts.join(' · ') || 'Sin metadatos'
    }
  }

  function applyLens(lens: ExplorationLens): void {
    hooks.engine.setGraphFilters(lensToGraphFilters(lens))
    hooks.engine.setHeatmapMode(lens.heatmap || 'off')
    saveHeatmapMode(lens.heatmap || 'off')
    hooks.engine.setHighlightNodeIds(lens.highlightNodeIds || [])

    const legend = document.getElementById('heatmap-legend')
    if (legend) legend.classList.toggle('active', lens.heatmap !== 'off')

    const focusId = lens.focusNodeId
    if (focusId) {
      if (lens.depth && lens.depth > 1 && hooks.enterAgentFocus) {
        hooks.enterAgentFocus(focusId, lens.depth)
      } else {
        hooks.engine.flyToNode(focusId)
      }
      hooks.selectNode?.(focusId, 400).catch(() => {})
    }

    hooks.showToast('Vista del agente aplicada', false)
    bar.classList.remove('pulse')
  }

  async function poll(): Promise<void> {
    try {
      const session = await fetchLensCurrent()
      if (!session.lens) {
        if (pending) bar.classList.remove('active')
        pending = null
        return
      }
      const changed = session.updated_at !== lastUpdatedAt
      render(session)
      if (changed) {
        lastUpdatedAt = session.updated_at
        bar.classList.add('pulse')
        if (autoApplyEnabled()) applyLens(session.lens)
      }
    } catch (err) {
      console.warn('[LGB] lens poll failed', err)
    }
  }

  btnApply?.addEventListener('click', () => {
    if (pending?.lens) applyLens(pending.lens)
  })

  btnDismiss?.addEventListener('click', () => {
    bar.classList.remove('active', 'pulse')
    pending = null
    lastUpdatedAt = null
  })

  btnCopy?.addEventListener('click', async () => {
    if (!pending?.lens) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(pending.lens, null, 2))
      hooks.showToast('Lens JSON copiado', false)
    } catch {
      hooks.showToast('No se pudo copiar al portapapeles', true)
    }
  })

  void poll()
  pollTimer = setInterval(() => { void poll() }, POLL_MS)

  function dismissAgentLensUi(): void {
    bar.classList.remove('active', 'pulse')
    pending = null
    lastUpdatedAt = null
    hooks.engine.setHighlightNodeIds([])
  }

  return {
    dismissAgentLensUi,
    destroy: () => {
      if (pollTimer) clearInterval(pollTimer)
    },
  }
}
