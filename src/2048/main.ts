import { mountBar } from '../shared/bar.ts'
import { onDirection } from '../shared/input.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { SIZE, init, move, type State, type Tile } from './logic.ts'
import meta from './meta.ts'

// Tile colors by value; bigger numbers get a smaller font so they fit.
const COLORS: Record<number, [string, string]> = {
  2: ['#eee4da', '#776e65'], 4: ['#ede0c8', '#776e65'], 8: ['#f2b179', '#f9f6f2'], 16: ['#f59563', '#f9f6f2'],
  32: ['#f67c5f', '#f9f6f2'], 64: ['#f65e3b', '#f9f6f2'], 128: ['#edcf72', '#f9f6f2'], 256: ['#edcc61', '#f9f6f2'],
  512: ['#edc850', '#f9f6f2'], 1024: ['#edc53f', '#f9f6f2'], 2048: ['#edc22e', '#f9f6f2'],
}
const SLIDE_MS = 110

const grid = document.querySelector<HTMLElement>('.grid')!
const overlay = document.querySelector<HTMLButtonElement>('.overlay')!
const scoreEl = document.querySelector('#score')!
const bestEl = document.querySelector('#best')!
grid.innerHTML = '<i></i>'.repeat(SIZE * SIZE)

const saved = store.get<State | null>('game', null)
let state: State = Array.isArray(saved?.tiles) ? saved : init(newSeed())
let best = store.get('best', 0)
let celebrated = state.won // show "you made 2048" once per game
const els = new Map<number, HTMLElement>()

mountBar(meta)
document.querySelector<HTMLButtonElement>('#new')!.onclick = newGame
overlay.onclick = () => (state.over ? newGame() : (overlay.hidden = true))

onDirection(document.querySelector('main')!, d => {
  if (!overlay.hidden) return
  const next = move(state, d)
  if (next === state) return
  state = next
  store.set('game', state) // pick up where you left off
  if (state.score > best) store.set('best', (best = state.score))
  render()
  if (state.over) setTimeout(() => show('No moves left', `Score ${state.score} · tap to play again`), 400)
  else if (state.won && !celebrated) {
    celebrated = true
    navigator.vibrate?.([30, 60, 30])
    setTimeout(() => show('You made 2048!', 'Tap to keep going'), 400)
  }
})

function newGame() {
  state = init(newSeed())
  celebrated = false
  store.set('game', state)
  overlay.hidden = true
  for (const el of els.values()) el.remove()
  els.clear()
  render()
}

function show(title: string, hint: string) {
  overlay.innerHTML = '<strong></strong><span></span>'
  overlay.querySelector('strong')!.textContent = title
  overlay.querySelector('span')!.textContent = hint
  overlay.hidden = false
}

function tileEl(t: Tile, cls: string) {
  const el = document.createElement('div')
  el.className = `tile ${cls}`
  const [bg, fg] = COLORS[t.value] ?? ['#3c3a32', '#f9f6f2']
  const digits = String(t.value).length
  el.innerHTML = `<b style="--bg-tile: ${bg}; --fg-tile: ${fg}; --size: ${digits < 3 ? 1 : digits === 3 ? 0.8 : 0.62}em">${t.value}</b>`
  place(el, t)
  grid.append(el)
  return el
}

const place = (el: HTMLElement, t: Tile) => {
  el.style.setProperty('--x', String(t.x))
  el.style.setProperty('--y', String(t.y))
}

function render() {
  const live = new Set<number>()
  for (const t of state.tiles) {
    live.add(t.id)
    if (els.has(t.id)) place(els.get(t.id)!, t)
    else if (t.from) {
      // The two old tiles slide into place, then give way to the merged one.
      for (const id of t.from) {
        const old = els.get(id)
        if (!old) continue
        old.style.zIndex = '0'
        place(old, t)
        setTimeout(() => old.remove(), SLIDE_MS)
        els.delete(id)
      }
      els.set(t.id, tileEl(t, 'merged'))
    } else els.set(t.id, tileEl(t, t.fresh ? 'fresh' : ''))
  }
  for (const [id, el] of els)
    if (!live.has(id)) {
      el.remove()
      els.delete(id)
    }
  scoreEl.textContent = String(state.score)
  bestEl.textContent = String(best)
}

render()
if (state.over) show('No moves left', `Score ${state.score} · tap to play again`)
