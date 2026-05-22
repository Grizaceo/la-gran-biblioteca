export const VIEW_PREFS_KEY = 'lgb.viewPrefs'
export const GRAPH_FILTERS_KEY = 'lgb.graphFilters'

export type QualityPreset = 'auto' | 'high' | 'low'
export type StudyFilter = 'all' | 'studied' | 'unstudied'
export type LayoutMode = 'tree' | 'constellation'

export interface ViewPrefs {
  starfield?: boolean
  photons?: boolean
  minimap?: boolean
  labels?: boolean
  quality?: QualityPreset
  layoutMode?: LayoutMode
}

export interface GraphFiltersState {
  workspaces: string[] | null
  hideTags: boolean
  showArchived: boolean
  studyFilter: StudyFilter
  minDegree: number
  hiddenEdgeTypes: string[]
}

export const DEFAULT_GRAPH_FILTERS: GraphFiltersState = {
  workspaces: null,
  hideTags: false,
  showArchived: false,
  studyFilter: 'all',
  minDegree: 0,
  hiddenEdgeTypes: [],
}

export function loadViewPrefs(): ViewPrefs {
  try {
    return JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || '{}') as ViewPrefs
  } catch {
    return {}
  }
}

export function saveViewPrefs(prefs: ViewPrefs): void {
  localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs))
}

export function loadGraphFilters(): GraphFiltersState {
  try {
    const raw = JSON.parse(localStorage.getItem(GRAPH_FILTERS_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_GRAPH_FILTERS }
    return { ...DEFAULT_GRAPH_FILTERS, ...raw }
  } catch {
    return { ...DEFAULT_GRAPH_FILTERS }
  }
}

export function saveGraphFilters(filters: GraphFiltersState): void {
  localStorage.setItem(GRAPH_FILTERS_KEY, JSON.stringify(filters))
}

export function getLayoutMode(): LayoutMode {
  return loadViewPrefs().layoutMode === 'constellation' ? 'constellation' : 'tree'
}
