import { mountBar } from '../shared/bar.ts'
import { fitCanvas } from '../shared/canvas.ts'
import { onDirection } from '../shared/input.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { COLS, ROWS, init, step, tickMs, turn, type State } from './logic.ts'
import meta from './meta.ts'

const COLORS = { board: '#161a21', check: '#1b2029', snake: '#4ade80', head: '#bbf7d0', food: '#f472b6' }

const overlay = document.querySelector<HTMLButtonElement>('.overlay')!
const scoreEl = document.querySelector('#score')!
const bestEl = document.querySelector('#best')!

let state: State = init(newSeed())
let mode: 'ready' | 'playing' | 'paused' | 'over' = 'ready'
let best = store.get('best', 0)
let last = 0
let lag = 0

mountBar(meta, pause)
const view = fitCanvas(document.querySelector('canvas')!, COLS, ROWS, draw)
bestEl.textContent = String(best)

onDirection(document.querySelector('main')!, d => {
  if (mode === 'over') return // only the button restarts, so a stray swipe can't
  state = turn(state, d)
  start()
})
overlay.onclick = start
document.addEventListener('visibilitychange', () => document.hidden && pause())
addEventListener('blur', pause)

function start() {
  if (mode === 'playing') return
  if (mode === 'over') state = init(newSeed())
  mode = 'playing'
  overlay.hidden = true
  last = performance.now()
  lag = 0
  draw()
  requestAnimationFrame(frame)
}

function pause() {
  if (mode !== 'playing') return
  mode = 'paused'
  show('Paused', 'Tap or swipe to carry on')
}

function frame(now: number) {
  if (mode !== 'playing') return
  lag = Math.min(lag + now - last, 500) // after a stall, drop the backlog instead of racing through it
  last = now
  const before = state
  while (state.alive && lag >= tickMs(state)) {
    lag -= tickMs(state)
    state = step(state)
  }
  if (state === before) return requestAnimationFrame(frame)
  if (state.score > before.score) navigator.vibrate?.(15)
  draw()
  if (state.alive) requestAnimationFrame(frame)
  else gameOver()
}

function gameOver() {
  mode = 'over'
  navigator.vibrate?.(80)
  if (state.score > best) {
    best = state.score
    store.set('best', best)
    bestEl.textContent = String(best)
  }
  show('Game over', `Score ${state.score} · tap to play again`)
}

function show(title: string, hint: string) {
  overlay.innerHTML = '<strong></strong><span></span>'
  overlay.querySelector('strong')!.textContent = title
  overlay.querySelector('span')!.textContent = hint
  overlay.hidden = false
  overlay.focus()
}

function draw() {
  const { ctx, cell } = view
  ctx.fillStyle = COLORS.board
  ctx.fillRect(0, 0, COLS * cell, ROWS * cell)
  ctx.fillStyle = COLORS.check
  for (let y = 0; y < ROWS; y++) for (let x = y % 2; x < COLS; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell)

  ctx.fillStyle = COLORS.food
  ctx.beginPath()
  ctx.arc((state.food.x + 0.5) * cell, (state.food.y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2)
  ctx.fill()

  state.snake.forEach((c, i) => {
    ctx.fillStyle = i ? COLORS.snake : COLORS.head
    ctx.beginPath()
    ctx.roundRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2, cell * 0.3)
    ctx.fill()
  })
  scoreEl.textContent = String(state.score)
}
