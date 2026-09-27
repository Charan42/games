import { mountBar } from '../shared/bar.ts'
import { newSeed, rand } from '../shared/rng.ts'
import { opponentPicker } from '../shared/versus.ts'
import { N, bestMove, count, init, moves, play, type Player } from './logic.ts'
import meta from './meta.ts'

// Look-ahead in moves; how far below the best the computer may wander; how many empty
// squares from the end it starts playing perfectly.
const STRENGTH = { easy: { depth: 1, slack: 20, endgame: 0 }, hard: { depth: 4, slack: 0, endgame: 10 } }
const NAME = { 1: 'Black', 2: 'White' }

const grid = document.querySelector<HTMLElement>('.grid')!
const statusEl = document.querySelector('#status')!
const blackEl = document.querySelector('#black')!
const whiteEl = document.querySelector('#white')!
grid.innerHTML = '<i><b></b></i>'.repeat(N * N)
const cells = [...grid.children] as HTMLElement[]

mountBar(meta)
const opponent = opponentPicker(document.querySelector('#opponent')!, newGame)
document.querySelector<HTMLButtonElement>('#new')!.onclick = newGame

let state = init()
let games = 0
let cpu: Player = 2 // the computer's color; it swaps every game
let cursor = 19
let seed = newSeed()

const vsCpu = () => opponent() !== 'friend'
const cpuTurn = () => vsCpu() && state.turn === cpu && !state.over

function newGame() {
  games++
  cpu = games % 2 ? 1 : 2
  state = init()
  update()
}

function place(i: number) {
  if (cpuTurn()) return
  const next = play(state, i)
  if (next === state) return
  state = next
  navigator.vibrate?.(15)
  update()
}

function update() {
  render()
  if (!cpuTurn()) return
  const game = games
  const { depth, slack, endgame } = STRENGTH[opponent() as 'easy' | 'hard']
  setTimeout(() => {
    if (game !== games || !cpuTurn()) return
    const [luck, next] = rand(seed)
    seed = next
    state = play(state, bestMove(state, depth, luck, slack, endgame))
    update()
  }, 600)
}

function render() {
  const hints = cpuTurn() || state.over ? [] : moves(state.board, state.turn)
  cells.forEach((el, i) => {
    const v = state.board[i]
    el.className = v ? `d${v}` : hints.includes(i) ? 'hint' : ''
    if (i === state.last) el.classList.add('last')
    if (state.flipped.includes(i)) el.classList.add('flip')
    if (i === cursor && document.body.dataset.keys) el.classList.add('cursor')
  })
  const [b, w] = [count(state.board, 1), count(state.board, 2)]
  blackEl.textContent = String(b)
  whiteEl.textContent = String(w)

  const who = (p: Player) => (vsCpu() ? (p === cpu ? 'The computer' : 'You') : NAME[p])
  if (state.over) {
    const winner: Player | 0 = b > w ? 1 : w > b ? 2 : 0
    statusEl.textContent = !winner ? 'Draw' : who(winner) === 'You' ? 'You win!' : `${who(winner)} wins!`
  } else {
    const other: Player = state.turn === 1 ? 2 : 1
    const pass = state.passed ? `${NAME[other]} can’t move. ` : ''
    statusEl.textContent =
      pass + (cpuTurn() ? 'Thinking…' : vsCpu() ? `Your turn (${NAME[state.turn].toLowerCase()})` : `${NAME[state.turn]} to play`)
  }
}

grid.addEventListener('pointerdown', e => {
  const r = grid.getBoundingClientRect()
  const col = Math.floor(((e.clientX - r.left) / r.width) * N)
  const row = Math.floor(((e.clientY - r.top) / r.height) * N)
  if (col >= 0 && col < N && row >= 0 && row < N) place(row * N + col)
})
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -N, ArrowDown: N }
addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || (e.target as Element).closest('button')) return
  if (e.key in STEP) {
    e.preventDefault()
    document.body.dataset.keys = '1' // show the cursor once the keyboard is in use
    cursor = (cursor + STEP[e.key] + N * N) % (N * N)
    render()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    place(cursor)
  }
})

update()
