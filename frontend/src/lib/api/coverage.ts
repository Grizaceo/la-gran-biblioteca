import { fetchOverviewStructure } from './graph'
import type { OverviewStructure } from './types'

/** Coverage HUD uses overview-structure (study_ratio, clusters). Same data as GET /api/coverage. */
export async function fetchCoverage(): Promise<OverviewStructure> {
  return fetchOverviewStructure()
}
