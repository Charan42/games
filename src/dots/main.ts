import { mountBar } from '../shared/bar.ts'
import { fitCanvas } from '../shared/canvas.ts'
import { newSeed, rand } from '../shared/rng.ts'
import { opponentPicker } from '../shared/versus.ts'
import { COLS, LINES, ROWS, bestLine, draw, horizontal, init, over, start, type Player } from './logic.ts'
import meta from './meta.ts'

const CPU: Player = 2
const COLOR = { 1: '#3b82f6', 2: '#f43f5e' }
const FILL = { 1: 'rgb(59 130 246 / 0.28)', 2: 'rgb(244 63 94 / 0.28)' }
const NAME = { 1: 'Blue', 2: 'Red' }

const canvas = document.querySelector('canvas')!
const statusEl = document.querySelector('#status')!
const scoreEls = { 1: document.querySelector('#s1')!, 2: document.querySelector('#s2')! }

mountBar(meta)
const opponent = opponentPicker(document.querySelector('#opponent')!, newGame)
document.querySelector<HTMLButtonElement>('#new')!.onclick = newGame
// The dots sit on cell corners, so the board is one cell bigger than the boxes, with half a
// cell of margin all round.
const view = fitCanvas(canvas, COLS + 1, ROWS + 1, render)

let state = init()
let games = 0
let hover = -1
let seed = newSeed()

const vsCpu = () => opponent() !== 'friend'
const cpuTurn = () => vsCpu() && state.turn === CPU && !over(state)

function newGame() {
  games++
  state = init(games % 2 ? 2 : 1)
  update()
}

function play(e: number) {
  if (cpuTurn() || e < 0) return
  const next = draw(state, e)
  if (next === state) return
  navigator.vibrate?.(next.turn === state.turn ? [20, 40, 20] : 10)
  state = next
  update()
}

function update() {
  render()
  if (!cpuTurn()) return
  const game = games
  setTimeout(() => {
    if (game !== games || !cpuTurn()) return
    const [luck, next] = rand(seed)
    seed = next
    state = draw(state, bestLine(state, opponent() === 'hard', luck))
    update()
  }, 380)
}

// Where line e runs, in canvas pixels: [x0, y0, x1, y1].
function ends(e: number, cell: number) {
  const [c, r] = start(e)
  const [x, y] = [(c + 0.5) * cell, (r + 0.5) * cell]
  return horizontal(e) ? [x, y, x + cell, y] : [x, y, x, y + cell]
}

function render() {
  const { ctx, cell } = view
  ctx.clearRect(0, 0, (COLS + 1) * cell, (ROWS + 1) * cell)
  state.boxes.forEach((p, b) => {
    if (!p) return
    const [x, y] = [((b % COLS) + 0.5) * cell, (Math.floor(b / COLS) + 0.5) * cell]
    ctx.fillStyle = FILL[p as Player]
    ctx.fillRect(x, y, cell, cell)
    ctx.fillStyle = COLOR[p as Player]
    ctx.font = `700 ${cell * 0.38}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(NAME[p as Player][0], x + cell / 2, y + cell / 2)
  })
  ctx.lineCap = 'round'
  for (let e = 0; e < LINES; e++) {
    const who = state.lines[e] as Player | 0
    const [x0, y0, x1, y1] = ends(e, cell)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    if (who) {
      ctx.strokeStyle = COLOR[who]
      ctx.lineWidth = e === state.last ? cell * 0.14 : cell * 0.09
    } else {
      ctx.strokeStyle = e === hover ? COLOR[state.turn] : 'rgb(128 128 128 / 0.18)'
      ctx.lineWidth = e === hover ? cell * 0.07 : cell * 0.03
    }
    ctx.stroke()
  }
  ctx.fillStyle = getComputedStyle(document.body).color
  for (let r = 0; r <= ROWS; r++)
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath()
      ctx.arc((c + 0.5) * cell, (r + 0.5) * cell, cell * 0.075, 0, Math.PI * 2)
      ctx.fill()
    }

  scoreEls[1].textContent = String(state.score[1])
  scoreEls[2].textContent = String(state.score[2])
  const [a, b] = [state.score[1], state.score[2]]
  const who = (p: Player) => (vsCpu() ? (p === CPU ? 'The computer' : 'You') : NAME[p])
  statusEl.textContent = over(state)
    ? a === b
      ? 'Draw'
      : who(a > b ? 1 : 2) === 'You'
        ? 'You win!'
        : `${who(a > b ? 1 : 2)} wins!`
    : cpuTurn()
      ? 'Thinking…'
      : vsCpu()
        ? 'Your turn'
        : `${NAME[state.turn]}’s turn`
}

// The undrawn line nearest the pointer, within half a cell of its middle; -1 if none.
function lineNear(ev: PointerEvent) {
  const r = canvas.getBoundingClientRect()
  const cell = r.width / (COLS + 1)
  const [px, py] = [ev.clientX - r.left, ev.clientY - r.top]
  let best = -1
  let dist = cell * 0.5
  for (let e = 0; e < LINES; e++) {
    if (state.lines[e]) continue
    const [x0, y0, x1, y1] = ends(e, cell)
    const d = Math.hypot(px - (x0 + x1) / 2, py - (y0 + y1) / 2)
    if (d < dist) [best, dist] = [e, d]
  }
  return best
}
canvas.addEventListener('pointerdown', e => play(lineNear(e)))
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return
  const h = cpuTurn() ? -1 : lineNear(e)
  if (h === hover) return
  hover = h
  render()
})
canvas.addEventListener('pointerleave', () => {
  hover = -1
  render()
})

update()
