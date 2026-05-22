import type { GraphFiltersState } from './viewPrefs'

export function getNodeWorkspace(
  node: Record<string, unknown>,
  workspaceRoot: string,
): string {
  const path = String(node.path || '').replace(/\\/g, '/')
  const nodeId = String(node.id || '').replace(/\\/g, '/')
  const blob = `${path} ${nodeId}`.toLowerCase()
  if (blob.includes('/imports/github/') || blob.includes('imports/github/')) {
    return 'imports'
  }
  if (!path || !workspaceRoot) return ''
  const root = workspaceRoot.replace(/\\/g, '/')
  if (path.startsWith(root + '/')) {
    const rel = path.slice(root.length + 1)
    return rel.split('/')[0] || 'root'
  }
  const parts = path.split('/').filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

export function passesGraphFilters(
  node: Record<string, unknown>,
  filters: GraphFiltersState,
  getWorkspace: (node: Record<string, unknown>) => string,
): boolean {
  const type = (node.type as string) || 'default'
  const meta = (node.metadata as Record<string, unknown>) || {}
  if (filters.hideTags && (type === 'tag' || meta.is_tag)) {
    return false
  }
  if (!filters.showArchived && meta.archived === true) {
    return false
  }
  if (filters.workspaces !== null) {
    if (filters.workspaces.length === 0) return false
    const ws = getWorkspace(node)
    if (!ws || !filters.workspaces.includes(ws)) return false
  }
  const study = Number(meta.study_count) || 0
  if (filters.studyFilter === 'studied' && study <= 0) return false
  if (filters.studyFilter === 'unstudied' && study > 0) return false
  const degree = Number(node.degree) || 0
  if (filters.minDegree > 0 && degree < filters.minDegree) return false
  return true
}

export function isNodeGraphVisible(
  node: Record<string, unknown>,
  filters: GraphFiltersState,
  hiddenTypes: Set<string>,
  getWorkspace: (node: Record<string, unknown>) => string,
): boolean {
  const type = (node.type as string) || 'default'
  return !hiddenTypes.has(type) && passesGraphFilters(node, filters, getWorkspace)
}

export function isLinkGraphVisible(
  link: Record<string, unknown>,
  filters: GraphFiltersState,
  hiddenTypes: Set<string>,
  getWorkspace: (node: Record<string, unknown>) => string,
): boolean {
  const edgeType = (link.type as string) || 'default'
  if (filters.hiddenEdgeTypes.includes(edgeType)) return false
  const src = link.source as Record<string, unknown>
  const tgt = link.target as Record<string, unknown>
  if (!src || !tgt || typeof src !== 'object' || typeof tgt !== 'object') return false
  return (
    isNodeGraphVisible(src, filters, hiddenTypes, getWorkspace)
    && isNodeGraphVisible(tgt, filters, hiddenTypes, getWorkspace)
  )
}

export function mergeImportsIntoWorkspaceFilter(
  filters: GraphFiltersState,
  allWorkspaces: string[],
): Partial<GraphFiltersState> {
  if (filters.workspaces === null) return {}
  if (!allWorkspaces.includes('imports')) return {}
  const selected = [...new Set([...(filters.workspaces || []), 'imports'])]
  return {
    workspaces: selected.length >= allWorkspaces.length ? null : selected,
  }
}
