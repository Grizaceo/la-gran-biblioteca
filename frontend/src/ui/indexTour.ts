import type { Graph3DEngine } from '../render3d/Graph3DEngine'
import { fetchTour, type ExplorationTour, type TourStep } from '../lib/api/tour'
import { publishLens } from '../lib/api/lens'

export interface IndexTourHooks {
  engine: Graph3DEngine
  showToast: (msg: string, isError?: boolean) => void
  selectNode?: (id: string, delay?: number) => Promise<void>
  getDefaultWorkspace?: () => string | null
}

export function initIndexTour(hooks: IndexTourHooks): { destroy: () => void } {
  const host = document.getElementById('stats')?.parentElement ?? document.getElementById('menu-bar')
  if (!host) return { destroy: () => {} }

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.id = 'btn-index-tour'
  btn.className = 'detail-btn'
  btn.textContent = 'Tour índice'
  btn.title = 'Recorre secciones del index.md (wiki Karpathy)'
  btn.style.marginLeft = '8px'
  host.appendChild(btn)

  let tour: ExplorationTour | null = null
  let stepIdx = 0

  async function loadTour(): Promise<ExplorationTour | null> {
    const ws =
      hooks.getDefaultWorkspace?.() ||
      tour?.workspace ||
      null
    if (!ws) {
      hooks.showToast('Elige un workspace con index.md', true)
      return null
    }
    try {
      tour = await fetchTour(ws)
      stepIdx = 0
      return tour
    } catch {
      hooks.showToast(`Sin tour para «${ws}»`, true)
      return null
    }
  }

  async function applyStep(step: TourStep): Promise<void> {
    const ids = step.highlight_node_ids || []
    hooks.engine.setHighlightNodeIds(ids)
    const focus = step.focus_node_id || ids[0]
    if (focus) {
      hooks.engine.flyToNode(focus)
      await hooks.selectNode?.(focus, 400)
    }
    try {
      await publishLens({
        lens: {
          version: 1,
          id: 'follow_index',
          label: `Índice: ${step.title}`,
          workspaces: null,
          topics: null,
          folders: null,
          studyFilter: 'all',
          minDegree: 0,
          hideTags: false,
          showArchived: false,
          hiddenEdgeTypes: [],
          highlightNodeIds: ids,
          focusNodeId: focus,
          heatmap: 'off',
        },
        updated_by: 'ui',
        focus_node_id: focus,
        highlight_ids: ids,
      })
    } catch {
      /* lens publish optional if bridge down */
    }
    hooks.showToast(`Paso ${stepIdx + 1}/${tour?.steps.length ?? '?'}: ${step.title}`, false)
  }

  btn.addEventListener('click', async () => {
    if (!tour?.steps.length) {
      const loaded = await loadTour()
      if (!loaded?.steps.length) return
    }
    const step = tour!.steps[stepIdx]
    if (!step) {
      stepIdx = 0
      hooks.showToast('Tour reiniciado', false)
      return
    }
    await applyStep(step)
    stepIdx += 1
    if (stepIdx >= tour!.steps.length) {
      hooks.showToast('Tour completado', false)
      stepIdx = 0
    }
  })

  return {
    destroy: () => {
      btn.remove()
    },
  }
}
