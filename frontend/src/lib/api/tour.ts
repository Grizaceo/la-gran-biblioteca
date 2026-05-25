import { apiGet } from './client'

export interface TourStep {
  order: number
  title: string
  highlight_node_ids: string[]
  focus_node_id?: string
}

export interface ExplorationTour {
  workspace: string
  steps: TourStep[]
  updated_at?: string
}

export async function fetchTour(workspace: string): Promise<ExplorationTour> {
  return apiGet<ExplorationTour>(`/api/tour/${encodeURIComponent(workspace)}`)
}

export async function fetchTours(): Promise<{ tours: ExplorationTour[] }> {
  return apiGet<{ tours: ExplorationTour[] }>('/api/tour')
}
