import { mountBar } from '../shared/bar.ts'
import { newSeed, rand } from '../shared/rng.ts'
import { opponentPicker } from '../shared/versus.ts'
import { COLS, ROWS, bestMove, canDrop, drop, init, landing, over, type Player } from './logic.ts'
import meta from './meta.ts'

const CPU: Player = 2
// Look-ahead in moves, and how far below the best move the computer may wander.
const STRENGTH = { easy: { depth: 2, slack: 30 }, hard: { depth: 7, slack: 0 } }
const NAME = { 1: 'Red', 2: 'Yellow' }

const grid = document.querySelector<HTMLElement>('.grid')!
const statusEl = document.querySelector('#status')!
const tallyEl = document.querySelector('#tally')!
grid.innerHTML = '<i></i>'.repeat(COLS * ROWS)
const cells = [...grid.children] as HTMLElement[]

mountBar(meta)
const opponent = opponentPicker(document.querySelector('#opponent')!, () => {
  Object.assign(tally, { 1: 0, 2: 0, draw: 0 })
  newGame()
})
document.querySelector<HTMLButtonElement>('#new')!.onclick = newGame

let state = init()
let games = 0
let hover = 3
let seed = newSeed()
const tally = { 1: 0, 2: 0, draw: 0 }

const vsCpu = () => opponent() !== 'friend'
const cpuTurn = () => vsCpu() && state.turn === CPU && !over(state)

function newGame() {
  games++
  state = init(games % 2 ? 2 : 1) // take turns going first
  update()
}

function play(col: number) {
  if (cpuTurn() || !canDrop(state, col)) return
  state = drop(state, col)
  update()
}

function update() {
  if (over(state)) {
    tally[state.winner || 'draw']++
    navigator.vibrate?.(state.winner ? [30, 60, 30] : 30)
  } else if (cpuTurn()) {
    const game = games
    const { depth, slack } = STRENGTH[opponent() as 'easy' | 'hard']
    // Let the player's disc land before the computer answers.
    setTimeout(() => {
      if (game !== games || !cpuTurn()) return // a new game started meanwhile
      const [luck, next] = rand(seed)
      seed = next
      state = drop(state, bestMove(state, depth, luck, slack))
      update()
    }, 450)
  }
  render()
}

function render() {
  const ghost = !over(state) && !cpuTurn() && landing(state.board, hover) >= 0 ? landing(state.board, hover) * COLS + hover : -1
  cells.forEach((el, i) => {
    const v = state.board[i]
    el.className = v ? `p${v}` : i === ghost ? `ghost p${state.turn}` : ''
    if (state.line.includes(i)) el.classList.add('win')
    // The newest disc falls in. Re-rendering keeps the class, which doesn't restart the fall.
    if (i === state.last) {
      el.classList.add('drop')
      el.style.setProperty('--fall', String(Math.floor(i / COLS) + 1))
    }
  })

  const you = (p: Player) => (vsCpu() ? (p === CPU ? 'The computer' : 'You') : NAME[p])
  statusEl.textContent = state.winner
    ? `${you(state.winner)} win${vsCpu() && state.winner !== CPU ? '' : 's'}!`
    : state.full
      ? 'Draw'
      : cpuTurn()
        ? 'Thinking…'
        : vsCpu()
          ? 'Your turn'
          : `${NAME[state.turn]}’s turn`
  tallyEl.textContent = vsCpu()
    ? `You ${tally[1]} · CPU ${tally[2]}`
    : `Red ${tally[1]} · Yellow ${tally[2]}`
}

const column = (e: PointerEvent) => {
  const r = grid.getBoundingClientRect()
  return Math.min(COLS - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * COLS)))
}
grid.addEventListener('pointerdown', e => play((hover = column(e))))
grid.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse' && column(e) !== hover) {
    hover = column(e)
    render()
  }
})
addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return
  const n = Number(e.key)
  if (n >= 1 && n <= COLS) play((hover = n - 1))
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    hover = (hover + (e.key === 'ArrowLeft' ? COLS - 1 : 1)) % COLS
    render()
  } else if (e.key === 'Enter' || e.key === ' ') {
    if ((e.target as Element).closest('button')) return
    e.preventDefault()
    play(hover)
  } else if (e.key === 'n') newGame()
})

update()
