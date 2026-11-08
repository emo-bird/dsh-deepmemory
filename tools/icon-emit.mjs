// Emit the whale path for both the bundle icon (36 grid) and the 24px sidebar
// glyph from one set of coordinates, so the two can never drift apart.
//
// `icon-shape.py` is the source of truth; run `node tools/icon-emit.mjs` after
// editing it, then paste the two paths into `icon.svg` and `lib/client.js`.
import { readFileSync, writeFileSync } from 'node:fs'

const shapeUrl = new URL('./icon-shape.py', import.meta.url)
const outUrl = new URL('./icon-paths.json', import.meta.url)

const source = readFileSync(shapeUrl, 'utf8')
const body = [...source.matchAll(/\('(M|C|L)',\s*(\([^)]*\)(?:,\s*\([^)]*\)){0,2})\)/g)].map((m) => ({
  cmd: m[1],
  pts: [...m[2].matchAll(/\(([^)]*)\)/g)].map((p) =>
    p[1].split(',').map((n) => Number(n.trim())),
  ),
}))
const dotsLine = source.match(/DOTS = \[([^\]]*)\]/)[1]
const dots = [...dotsLine.matchAll(/\(([\d.]+), ([\d.]+), ([\d.]+)\)/g)].map((m) =>
  m.slice(1).map(Number),
)

const round = (n) => Number(n.toFixed(2))
const seg = (list) =>
  list
    .map((s) =>
      s.cmd === 'M'
        ? `M${round(s.pts[0][0])} ${round(s.pts[0][1])}`
        : s.cmd === 'C'
          ? `C${s.pts.map((p) => `${round(p[0])} ${round(p[1])}`).join(' ')}`
          : `L${round(s.pts[0][0])} ${round(s.pts[0][1])}`,
    )
    .join('')

const scale = (list, k) =>
  list.map((s) => ({ cmd: s.cmd, pts: s.pts.map(([x, y]) => [x * k, y * k]) }))
const circle = (cx, cy, r, k) =>
  `M${round((cx - r) * k)} ${round(cy * k)}a${round(r * k)} ${round(r * k)} 0 1 0 ${round(2 * r * k)} 0a${round(r * k)} ${round(r * k)} 0 1 0 ${round(-2 * r * k)} 0`

// The bundle icon draws at 36 units; the sidebar glyph at 24, viewed at ~18 CSS
// px. At that size an eye reads as a stray speck and a hairline dot vanishes,
// so the sidebar variant drops the eye and enlarges the three holes.
const icon36 = seg(body)
const side24 = seg(scale(body, 2 / 3)) + dots.map(([cx, cy]) => circle(cx, cy, 1.15, 2 / 3)).join('')

writeFileSync(outUrl, JSON.stringify({ icon36, side24 }, null, 2) + '\n')
console.log('icon36', icon36.length, 'chars')
console.log('side24', side24.length, 'chars')
