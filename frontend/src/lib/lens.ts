/** ExplorationLens — shared contract with backend/lens.py */

import type { GraphFiltersState, StudyFilter } from '../render3d/viewPrefs'

export type HeatmapMode = 'off' | 'volume' | 'study'

export interface ExplorationLens {
  version: 1
  id?: string | null
  label?: string | null
  workspaces: string[] | null
  topics: string[] | null
  folders: string[] | null
  studyFilter: StudyFilter
  minDegree: number
  hideTags: boolean
  showArchived: boolean
  hiddenEdgeTypes: string[]
  heatmap: HeatmapMode
  focusNodeId?: string | null
  highlightNodeIds?: string[]
  depth?: number | null
}

export interface SessionLensResponse {
  lens: ExplorationLens | null
  updated_at: string | null
  updated_by: 'mcp' | 'ui' | string | null
}

export interface ApplyLensResponse {
  lens: ExplorationLens
  search_preview: Array<{ id: string; label?: string; type?: string }>
  suggested_focus_node_id: string | null
  highlight_node_ids: string[]
}

export const DEFAULT_LENS: ExplorationLens = {
  version: 1,
  workspaces: null,
  topics: null,
  folders: null,
  studyFilter: 'all',
  minDegree: 0,
  hideTags: false,
  showArchived: false,
  hiddenEdgeTypes: [],
  heatmap: 'off',
  highlightNodeIds: [],
}

export const LENS_PRESETS = [
  'heatmap_study',
  'heatmap_volume',
  'gaps_unstudied',
  'agent_default',
] as const

export type LensPresetId = (typeof LENS_PRESETS)[number]

export function lensToGraphFilters(lens: ExplorationLens): Partial<GraphFiltersState> {
  return {
    workspaces: lens.workspaces,
    topics: lens.topics,
    folders: lens.folders,
    hideTags: lens.hideTags,
    showArchived: lens.showArchived,
    studyFilter: lens.studyFilter,
    minDegree: lens.minDegree,
    hiddenEdgeTypes: [...(lens.hiddenEdgeTypes || [])],
  }
}

export function clusterToLens(
  mode: 'workspace' | 'folder' | 'topic',
  key: string,
  label: string,
  heatmap: HeatmapMode = 'study',
): ExplorationLens {
  const base: ExplorationLens = {
    ...DEFAULT_LENS,
    label: `${label} (${mode})`,
    heatmap,
  }
  if (mode === 'workspace') {
    return { ...base, workspaces: [key], topics: null, folders: null }
  }
  if (mode === 'topic') {
    return { ...base, workspaces: null, topics: [key], folders: null }
  }
  const workspace = key.split('/')[0] || null
  return {
    ...base,
    workspaces: workspace ? [workspace] : null,
    topics: null,
    folders: [key.replace(/\\/g, '/')],
  }
}
