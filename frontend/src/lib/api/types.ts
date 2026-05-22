export interface Node {
  id: string
  type: string
  label: string
  path: string
  metadata: Record<string, unknown>
  position: { x: number; y: number; z?: number }
}

export interface Edge {
  source: string
  target: string
  type: string
}

export interface Graph {
  nodes: Node[]
  edges: Edge[]
  total?: number
}

export interface Overview {
  total_nodes: number
  total_edges: number
  by_type: Record<string, number>
  top_workspaces: Array<{ workspace: string; nodes: number }>
  recent_imports: string[]
  workspace_root: string
  skipped_archive_dirs?: number
}

export type GraphUpdateEvent = 'init' | 'update'

export interface NodeContent {
  content: string
  lang: string
  size: number
  truncated: boolean
}

export interface ArxivSearchHit {
  arxiv_id: string
  title: string
  authors: string[]
  published: string
  updated: string
  categories: string[]
  abstract: string
  abs_url: string
  pdf_url: string
  withdrawn?: boolean
}

export interface ArxivSearchResponse {
  total: number | null
  results: ArxivSearchHit[]
}

export interface ImportNoteResponse {
  status: string
  path: string
  node_id?: string
  workspace_root?: string
}

export interface ConstellationCatalogEntry {
  id: string
  name: string
  name_es?: string
  star_count: number
}

export interface ConstellationPref {
  folder_path: string
  constellation_id: string
  status: 'suggested' | 'confirmed'
  suggested_from?: string
  updated_at?: string
}

export interface ConstellationStar {
  name?: string
  ra?: number
  dec?: number
  mag?: number
}

export interface ConstellationDetail {
  id: string
  name: string
  name_es?: string
  summary_es?: string
  season?: string
  hemisphere?: string
  center_ra?: number
  center_dec?: number
  star_count: number
  stars: ConstellationStar[]
}
