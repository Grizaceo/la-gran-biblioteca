export interface Node {
  id: string
  type: string
  label: string
  path: string
  metadata: Record<string, unknown>
  position: { x: number; y: number; z?: number }
}

export interface ConstellationFigureStar {
  x: number
  y: number
  z: number
  mag: number
}

export interface ConstellationFigure {
  constellation_id: string
  anchor: string
  name: string
  name_es: string
  stars: ConstellationFigureStar[]
  lines: [number, number][]
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
  pipeline?: {
    scan_ms: number
    finalize_ms: number
    build_ms: number
    node_count: number
    edge_count: number
  }
  limited_count?: number
}

export interface StructureCluster {
  key: string
  label: string
  count: number
  degree_sum?: number
  studied_count?: number
  study_ratio?: number
  avg_degree?: number
  study_score_sum?: number
  sample_node_ids?: string[]
  centroid?: { x: number; y: number }
}

export interface OverviewStructure {
  workspace_root: string
  total_nodes: number
  total_edges: number
  limited_count?: number
  shown_count?: number
  pipeline?: {
    scan_ms: number
    finalize_ms: number
    build_ms: number
    node_count: number
    edge_count: number
  }
  modes: {
    workspace: StructureCluster[]
    folder: StructureCluster[]
    topic: StructureCluster[]
  }
  legend: {
    workspaces: Array<{ key: string; count: number }>
    topics: Array<{ key: string; count: number }>
    roles: Record<string, number>
  }
}

export interface SearchHit {
  id: string
  label: string
  type: string
  path: string
  workspace: string
  topics: string[]
  degree: number
  structural_role: string
  study_count: number
  why: string
  folder?: string
  related_score?: number
  search_rank?: number
}

export interface SearchResponse {
  results: SearchHit[]
  total: number
  has_more: boolean
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
  star_count?: number
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
