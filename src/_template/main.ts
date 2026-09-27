import { mountBar } from '../shared/bar.ts'
import { fitCanvas } from '../shared/canvas.ts'
import { onDirection } from '../shared/input.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { COLS, ROWS, init, move, type State } from './logic.ts'
import meta from './meta.ts'

// Turn-based starter: each swipe or arrow key is one move, so there's no game loop.
// For a real-time game (loop, pause, game over), start from snake/main.ts instead.
const scoreEl = document.querySelector('#score')!
const bestEl = document.querySelector('#best')!

let state: State = init(newSeed())
let best = store.get('best', 0)

mountBar(meta)
const view = fitCanvas(document.querySelector('canvas')!, COLS, ROWS, draw)
bestEl.textContent = String(best)

onDirection(document.querySelector('main')!, d => {
  state = move(state, d)
  if (state.score > best) {
    best = state.score
    store.set('best', best)
    bestEl.textContent = String(best)
  }
  draw()
})

function draw() {
  const { ctx, cell } = view
  ctx.fillStyle = '#161a21'
  ctx.fillRect(0, 0, COLS * cell, ROWS * cell)

  ctx.fillStyle = '#f472b6'
  ctx.beginPath()
  ctx.arc((state.dot.x + 0.5) * cell, (state.dot.y + 0.5) * cell, cell * 0.3, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#4ade80'
  ctx.beginPath()
  ctx.roundRect(state.player.x * cell + 2, state.player.y * cell + 2, cell - 4, cell - 4, cell * 0.25)
  ctx.fill()

  scoreEl.textContent = String(state.score)
}
