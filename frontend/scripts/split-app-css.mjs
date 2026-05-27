/**
 * Splits monolithic app.css into component modules (preserves selectors verbatim).
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'src/styles/app.css'), 'utf8')

const COMPONENT_HEADERS = {
  base: '/* @component: base */\n',
  layout: '/* @component: layout */\n',
  panels: '/* @component: panels */\n',
  search: '/* @component: search */\n',
  nodes: '/* @component: nodes */\n',
  minimap: '/* @component: minimap */\n',
  activity: '/* @component: activity */\n',
  legend: '/* @component: legend */\n',
  components: '/* @component: components */\n',
  animations: '/* @component: animations */\n',
}

function extractKeyframes(src) {
  const blocks = []
  let i = 0
  while (i < src.length) {
    const start = src.indexOf('@keyframes', i)
    if (start === -1) break
    let depth = 0
    let started = false
    let end = start
    for (let j = start; j < src.length; j++) {
      const ch = src[j]
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') {
        depth--
        if (started && depth === 0) {
          end = j + 1
          break
        }
      }
    }
    blocks.push(src.slice(start, end))
    src = src.slice(0, start) + src.slice(end)
    i = start
  }
  return { src, keyframes: blocks.join('\n\n') }
}

function fileForSectionComment(comment) {
  const c = comment.toLowerCase().trim()
  if (c === 'search') return 'search'
  if (c.includes('search highlight')) return 'components'
  if (c.includes('context menu') || c.includes('tooltip')) return 'nodes'
  if (c.includes('minimap') || c.includes('breadcrumb')) return 'minimap'
  if (c.includes('activity log')) return 'activity'
  if (c.includes('legend') || c.includes('quick access')) return 'legend'
  if (c.includes('loading') || c.includes('top bar') || c.includes('menu bar')) return 'layout'
  if (c.includes('focus mode') || c.includes('controls')) return 'layout'
  if (
    c.includes('constellation')
    || c.includes('node detail')
    || c.includes('visibility')
    || c.includes('view options')
    || c.includes('neighbors')
    || c.includes('preview')
    || c.includes('markdown')
    || c.includes('hljs')
  ) return 'panels'
  if (c.includes('modal') || c.includes('notification') || c.includes('info message')) {
    return 'components'
  }
  return 'layout'
}

const { src: stripped, keyframes } = extractKeyframes(raw)

const buckets = Object.fromEntries(
  Object.keys(COMPONENT_HEADERS).map((k) => [k, COMPONENT_HEADERS[k]]),
)
if (keyframes.trim()) {
  buckets.animations += keyframes.trim() + '\n'
}

let current = 'base'
for (const line of stripped.split('\n')) {
  const section = line.match(/^\s+\/\*\s*(.+?)\s*\*\/\s*$/)
  if (section) {
    current = fileForSectionComment(section[1])
    buckets[current] += line + '\n'
    continue
  }
  buckets[current] += line + '\n'
}

for (const name of Object.keys(COMPONENT_HEADERS)) {
  const path = join(root, `src/styles/${name}.css`)
  const body = buckets[name].trimEnd()
  writeFileSync(path, body + '\n')
  console.log('wrote', name, body.split('\n').length, 'lines')
}
