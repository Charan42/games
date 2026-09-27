import { mountBar } from '../shared/bar.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { LEVELS, flagsLeft, init, over, reveal, toggleFlag, type Level, type State } from './logic.ts'
import meta from './meta.ts'

const LONG_PRESS_MS = 380
const LEVEL_NAMES = Object.keys(LEVELS) as Level[]

const grid = document.querySelector<HTMLElement>('.grid')!
const $ = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!

let level = store.get<Level>('level', 'easy')
if (!(level in LEVELS)) level = 'easy'
let state: State
let cells: HTMLElement[] = []
let started = 0 // time of the first reveal
let finished = 0 // seconds taken, once the game is over
let timer = 0
let flagMode = false
let cursor = 0

mountBar(meta)
$('new').onclick = newGame
$('level').onclick = () => {
  level = LEVEL_NAMES[(LEVEL_NAMES.indexOf(level) + 1) % LEVEL_NAMES.length]
  store.set('level', level)
  newGame()
}
$('flagMode').onclick = () => {
  flagMode = !flagMode
  $('flagMode').setAttribute('aria-pressed', String(flagMode))
}

function newGame() {
  state = init(level, newSeed())
  started = 0
  clearInterval(timer)
  grid.style.setProperty('--cols', String(state.cols))
  grid.style.setProperty('--rows', String(state.rows))
  grid.innerHTML = '<i></i>'.repeat(state.cols * state.rows)
  cells = [...grid.children] as HTMLElement[]
  $('level').textContent = `${level[0].toUpperCase()}${level.slice(1)} · ${state.cols}×${state.rows}`
  cursor = Math.floor(state.cols / 2) + Math.floor(state.rows / 2) * state.cols
  render()
}

function act(next: State) {
  if (next === state) return
  const wasOver = over(state)
  if (!started && next.open.some(Boolean)) {
    started = performance.now()
    timer = window.setInterval(render, 1000)
  }
  state = next
  if (over(state) && !wasOver) {
    clearInterval(timer)
    navigator.vibrate?.(state.won ? [30, 60, 30] : 200)
    finished = seconds()
    if (state.won && finished < store.get(`best-${level}`, Infinity)) store.set(`best-${level}`, finished)
  }
  render()
}

const seconds = () => (started ? Math.floor((performance.now() - started) / 1000) : 0)

function render() {
  const s = state
  cells.forEach((el, i) => {
    let cls = ''
    let text = ''
    if (s.open[i]) {
      cls = `open n${s.near[i]}`
      text = s.near[i] ? String(s.near[i]) : ''
    } else if (over(s) && s.mine[i]) {
      cls = i === s.boom ? 'open boom' : 'open'
      text = s.flag[i] ? '🚩' : '💣'
    } else if (s.flag[i]) text = over(s) && !s.mine[i] ? '❌' : '🚩'
    if (i === cursor && document.body.dataset.keys) cls += ' cursor'
    if (el.className !== cls) el.className = cls
    if (el.textContent !== text) el.textContent = text
  })
  $('left').textContent = String(flagsLeft(s))
  $('time').textContent = String(over(s) ? finished : seconds())
  const best = store.get(`best-${level}`, Infinity)
  $('best').textContent = Number.isFinite(best) ? `${best}` : '–'
  $('status').textContent = s.won ? 'Cleared!' : s.boom >= 0 ? 'Boom!' : ''
}

// Touch: a tap opens, a long press flags. Mouse: left opens, right flags.
let press: { i: number; timer: number; x: number; y: number } | null = null
const cellAt = (e: PointerEvent) => cells.indexOf((e.target as Element).closest('i') as HTMLElement)

grid.addEventListener('pointerdown', e => {
  const i = cellAt(e)
  if (i < 0) return
  if (e.button === 2) return act(toggleFlag(state, i))
  cells[i].classList.add('pressed')
  press = {
    i,
    x: e.clientX,
    y: e.clientY,
    timer: window.setTimeout(() => {
      navigator.vibrate?.(25)
      act(toggleFlag(state, i))
      press = null
    }, LONG_PRESS_MS),
  }
})
grid.addEventListener('pointermove', e => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) cancel()
})
grid.addEventListener('pointerup', () => {
  if (!press) return
  const { i } = press
  cancel()
  act(flagMode && !state.open[i] ? toggleFlag(state, i) : reveal(state, i))
})
grid.addEventListener('pointercancel', cancel)
grid.addEventListener('contextmenu', e => e.preventDefault())
function cancel() {
  if (!press) return
  clearTimeout(press.timer)
  cells[press.i]?.classList.remove('pressed')
  press = null
}

addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || (e.target as Element).closest('button')) return
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -state.cols, ArrowDown: state.cols }
  if (e.key in step) {
    e.preventDefault()
    document.body.dataset.keys = '1'
    cursor = (cursor + step[e.key] + cells.length) % cells.length
    render()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    act(reveal(state, cursor))
  } else if (e.key === 'f') act(toggleFlag(state, cursor))
})

newGame()
