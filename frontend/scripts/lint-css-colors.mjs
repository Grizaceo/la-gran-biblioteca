/**
 * Flags hex colors in component CSS that duplicate tokens.css (use var(--*) instead).
 * rgba()/hsl() and palette-specific heatmap colors are allowed.
 * Usage: npm run lint:css-colors
 */
import { readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/styles')
const skipFiles = new Set(['tokens.css', 'app.css'])

/** Hex literals that exist as :root tokens — report so authors use var(--name). */
const TOKEN_HEX = [
  ['#000011', '--color-bg-deep'],
  ['#4fc3f7', '--color-accent'],
  ['#e57373', '--color-error'],
  ['#66bb6a', '--color-success'],
  ['#ffa726', '--color-warn'],
  ['#ef5350', '--color-error'],
  ['#81c784', '--color-success'],
  ['#ffb74d', '--color-warn'],
]

const violations = []
for (const file of readdirSync(stylesDir).filter((f) => f.endsWith('.css'))) {
  if (skipFiles.has(file)) continue
  const lines = readFileSync(join(stylesDir, file), 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (line.includes('var(--')) return
    const lower = line.toLowerCase()
    for (const [hex, token] of TOKEN_HEX) {
      if (lower.includes(hex)) {
        violations.push(`${file}:${i + 1}: use var(${token}) instead of ${hex}`)
        break
      }
    }
  })
}

if (violations.length) {
  console.warn(`lint-css-colors: ${violations.length} token-duplicating hex color(s) (advisory):\n`)
  violations.slice(0, 30).forEach((v) => console.warn('  ', v))
  if (violations.length > 30) console.warn(`  … and ${violations.length - 30} more`)
} else {
  console.log('lint-css-colors: ok')
}
