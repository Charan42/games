import wasmUrl from '@wasm/sand.wasm?url'
import { mountBar } from '../shared/bar.ts'
import { newSeed } from '../shared/rng.ts'
import meta from './meta.ts'
import { createRenderer } from './render.ts'

// The simulation is Rust (crate/src/lib.rs) compiled to WebAssembly. It only trades numbers
// with JS, so there's no generated glue code: these are its exports.
interface Sand {
  memory: WebAssembly.Memory
  init(w: number, h: number, seed: number): void
  step(): void
  paint(x0: number, y0: number, x1: number, y1: number, radius: number, kind: number): void
  clear(): void
  view(): number // address of the w × h × 4-byte buffer the renderer draws from
}

// Toolbar order, which is also the 1–9 and 0 keys. Ids match the element constants in crate/src/lib.rs.
const TOOLS = [
  { id: 2, name: 'Sand', color: '#e2c275' },
  { id: 3, name: 'Water', color: '#2f7fe0' },
  { id: 1, name: 'Wall', color: '#7a7d88' },
  { id: 4, name: 'Wood', color: '#8a5a2b' },
  { id: 6, name: 'Plant', color: '#3fb950' },
  { id: 8, name: 'Oil', color: '#6b5238' },
  { id: 7, name: 'Lava', color: '#ff5a1f' },
  { id: 5, name: 'Fire', color: '#ffb020' },
  { id: 14, name: 'Ice', color: '#bfe6ff' },
  { id: 0, name: 'Erase', color: '' },
]
const BRUSHES = [2, 5, 10] // radius in cells
// ponytail: cap measured on a desktop CPU (1.5 ms per step at 128k cells, heat included); retune after phone testing
const MAX_CELLS = 250_000
const STEP_MS = 1000 / 60 // 60 steps a second, whatever the screen's refresh rate

let tool = TOOLS[0].id
let brush = 1

mountBar(meta)
const canvas = document.querySelector('canvas')!
const tools = document.querySelector<HTMLElement>('.tools')!
tools.innerHTML =
  TOOLS.map(
    (t, i) =>
      `<button type="button" data-tool="${i}" aria-pressed="${i === 0}"${
        t.color ? ` style="--swatch: ${t.color}"` : ' class="erase"'
      }><i></i>${t.name}</button>`,
  ).join('') + '<button type="button" data-brush><i></i>Brush</button><button type="button" data-clear>Clear</button>'

// Two CSS pixels per cell, unless the screen is so big that would pass MAX_CELLS.
// Measured after the toolbar is in, so the board has its final size.
const board = canvas.parentElement!
const px = Math.max(2, Math.ceil(Math.sqrt((board.clientWidth * board.clientHeight) / MAX_CELLS)))
const W = Math.floor(board.clientWidth / px)
const H = Math.floor(board.clientHeight / px)

const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl))
const sand = instance.exports as unknown as Sand
sand.init(W, H, newSeed())

// A view straight into WASM memory, no copying. Made once: the sim never allocates after init.
const view = new Uint8Array(sand.memory.buffer, sand.view(), W * H * 4)
const draw = createRenderer(canvas, W, H)
if (!draw) board.textContent = 'This sandbox needs WebGL 2, which this browser doesn’t have.'
const render = () => draw?.(view, performance.now() / 1000)

// The largest board of whole CSS pixels per cell that fits, drawn at the screen's resolution.
new ResizeObserver(() => {
  const cell = Math.max(1, Math.floor(Math.min(board.clientWidth / W, board.clientHeight / H)))
  // ponytail: capped at 2x like shared/canvas.ts; 3x screens cost 2.25x the pixels for little gain
  const dpr = Math.min(devicePixelRatio, 2)
  canvas.style.width = `${cell * W}px`
  canvas.style.height = `${cell * H}px`
  canvas.width = Math.round(cell * W * dpr)
  canvas.height = Math.round(cell * H * dpr)
  render()
}).observe(board)

// Each finger (or the mouse) paints a line from where it was to where it is now.
const strokes = new Map<number, { x: number; y: number }>()
const cellAt = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect()
  return { x: Math.floor(((e.clientX - r.left) / r.width) * W), y: Math.floor(((e.clientY - r.top) / r.height) * H) }
}
const paint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  sand.paint(a.x, a.y, b.x, b.y, BRUSHES[brush], tool)

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId) // keep drawing if the finger slides off the board
  const p = cellAt(e)
  strokes.set(e.pointerId, p)
  paint(p, p)
})
canvas.addEventListener('pointermove', e => {
  const from = strokes.get(e.pointerId)
  if (!from) return
  const p = cellAt(e)
  paint(from, p)
  strokes.set(e.pointerId, p)
})
const lift = (e: PointerEvent) => strokes.delete(e.pointerId)
canvas.addEventListener('pointerup', lift)
canvas.addEventListener('pointercancel', lift)
canvas.addEventListener('contextmenu', e => e.preventDefault()) // long-press menus

function select(i: number) {
  tool = TOOLS[i].id
  tools.querySelectorAll('[data-tool]').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)))
}
function setBrush(i: number) {
  brush = i
  const dot = tools.querySelector<HTMLElement>('[data-brush] i')!
  dot.style.width = dot.style.height = `${6 + i * 6}px`
}
setBrush(brush)

function press(e: Event) {
  const b = (e.target as Element).closest('button')
  if (!b) return
  if (b.dataset.tool) select(Number(b.dataset.tool))
  else if (b.hasAttribute('data-brush')) setBrush((brush + 1) % BRUSHES.length)
  else sand.clear()
}
// Buttons act on touch-down, like the rest of the game, without waiting for the browser's
// tap detection. Keyboard presses arrive as clicks with detail 0.
tools.addEventListener('pointerdown', press)
tools.addEventListener('click', e => e.detail === 0 && press(e))
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return
  const n = e.key === '0' ? 10 : Number(e.key)
  if (n >= 1 && n <= TOOLS.length) select(n - 1)
  else if (e.key === 'b') setBrush((brush + 1) % BRUSHES.length)
  else if (e.key === 'c') sand.clear()
})

// Something is already happening on first load: lava dripping onto wood, sand pouring onto a
// ledge, water pooling around plants.
function scene() {
  const X = (f: number) => Math.round(f * W)
  const Y = (f: number) => Math.round(f * H)
  const ledge = Y(0.38)
  sand.paint(X(0.05), Y(0.55), X(0.45), Y(0.62), 2, 1) // sloping wall
  sand.paint(X(0.5), ledge, X(0.95), ledge, 2, 1) // flat wall
  sand.paint(X(0.6), ledge - 7, X(0.85), ledge - 7, 4, 4) // wood resting on it
  sand.paint(X(0.02), H - 1, X(0.4), H - 1, 1, 6) // plants along the floor
  sand.paint(X(0.7), H - 6, X(0.85), H - 6, 5, 14) // an ice block for the water to reach
  for (let i = 0; i < 3; i++) {
    // loose elements go on scattered, so pour them a few times
    sand.paint(X(0.72), Y(0.08), X(0.72), Y(0.08), 5, 7) // lava above the wood
    sand.paint(X(0.22), Y(0.25), X(0.22), Y(0.25), 9, 2) // sand above the slope
    sand.paint(X(0.3), Y(0.82), X(0.3), Y(0.82), 12, 3) // water above the plants
  }
}
scene()

let last = performance.now()
let lag = 0
requestAnimationFrame(function frame(now) {
  lag = Math.min(lag + now - last, STEP_MS * 4) // after a stall, skip ahead instead of catching up
  last = now
  if (lag >= STEP_MS) {
    while (lag >= STEP_MS) {
      for (const p of strokes.values()) paint(p, p) // a finger held still keeps pouring
      sand.step()
      lag -= STEP_MS
    }
    render()
  }
  requestAnimationFrame(frame)
})
