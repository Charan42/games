import wasmUrl from '@wasm/chess.wasm?url'
import { mountBar } from '../shared/bar.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { instantiate } from './engine.ts'
import { ENDINGS, KING, LEVELS, PAWN, from, isBlack, kind, material, promo, san, to, type Level } from './logic.ts'
import meta from './meta.ts'
import { SPRITES, pieceSvg } from './pieces.ts'
import type { Reply, Request } from './worker.ts'

type Opponent = Level | 'friend'
interface Game {
  moves: number[] // every move from the start, in the engine's encoding
  opponent: Opponent
  human: number // the color you play against the computer: 0 white, 1 black
  flipped: boolean // black at the bottom
}

const MIN_THINK_MS = 450 // even an instant reply waits this long, so the board doesn't jump at you
const OPPONENTS: Record<Opponent, string> = { easy: 'Computer · easy', medium: 'Computer · medium', hard: 'Computer · hard', friend: '' }
const PIECE_NAMES = ['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King']

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const statusEl = $('#status')
const grid = $('.chess')
const layer = $('.layer')
const promoEl = $('.promo')
const movesEl = $('.moves')
const setup = $<HTMLDialogElement>('#setup')
const form = setup.querySelector('form')!

document.body.insertAdjacentHTML('afterbegin', SPRITES)
grid.insertAdjacentHTML('afterbegin', '<i></i>'.repeat(64))
const cells = [...grid.querySelectorAll('i')] // in display order, top-left first
mountBar(meta)

// One engine instance here knows the rules; a second, in the worker, does the thinking.
const module = await WebAssembly.compileStreaming(fetch(wasmUrl))
const rules = await instantiate(module)
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
worker.postMessage(module)

let game: Game = { moves: [], opponent: 'easy', human: 0, flipped: false }
let sans: string[] = [] // the moves in notation, for the list under the board
let ending = 0 // the engine's status code once the game is over
let selected = -1
let cursor = -1 // the keyboard's square; hidden until an arrow key is pressed
let thinking = 0 // id of the request the computer is working on, 0 if none
let requests = 0
let askedAt = 0
let promoting: ((kind: number) => void) | null = null
let drag: { sq: number; el: HTMLElement; id: number; x: number; y: number; lift: number; moved: boolean; over: number; wasSelected: boolean } | null = null
const pieces = new Map<number, HTMLElement>() // square → piece element

const vsCpu = () => game.opponent !== 'friend'
const cpuTurn = () => vsCpu() && !ending && rules.side() !== game.human
const canMove = () => !ending && !cpuTurn() && !promoting
const legal = () => Array.from({ length: rules.legal_count() }, (_, i) => rules.legal_move(i))
const board = () => Array.from({ length: 64 }, (_, sq) => rules.piece(sq))
const colorOf = (p: number) => (isBlack(p) ? 1 : 0)
// Square ↔ display cell. Either way it's the same flip, so one function does both.
const cellOf = (sq: number) => (game.flipped ? (sq & 56) + 7 - (sq & 7) : 56 - (sq & 56) + (sq & 7))

// Plays a legal move on the rules engine and writes it down. Returns false if it isn't legal.
function record(m: number) {
  const before = board()
  const options = legal()
  if (!rules.play(m)) return false
  ending = rules.status()
  sans.push(san(before, options, m, ending === 1 ? '#' : rules.in_check() ? '+' : ''))
  game.moves.push(m)
  return true
}

function play(m: number) {
  const before = board()
  if (!record(m)) return false
  slide(before, m)
  selected = -1
  navigator.vibrate?.(ending ? [40, 60, 120] : before[to(m)] ? 30 : 15)
  save()
  render()
  if (cpuTurn()) ask()
  return true
}

function newGame(opponent: Opponent, human: number) {
  thinking = 0
  rules.reset()
  game = { moves: [], opponent, human, flipped: opponent !== 'friend' && human === 1 }
  sans = []
  ending = 0
  selected = -1
  placeAll()
  save()
  render()
  if (cpuTurn()) ask()
}

function undo() {
  promoting?.(0)
  // Against the computer, go back to your own last move: its reply too, if it made one.
  const n = vsCpu() && rules.side() === game.human ? 2 : 1
  if (!canUndo()) return
  thinking = 0
  for (let i = 0; i < n && game.moves.length; i++) {
    rules.undo()
    game.moves.pop()
    sans.pop()
  }
  ending = rules.status()
  selected = -1
  placeAll()
  save()
  render()
  if (cpuTurn()) ask()
}
// There's a move of yours to take back (as Black, the computer's first move doesn't count).
const canUndo = () => game.moves.length >= (vsCpu() && game.human === 1 ? 2 : 1)

function flip() {
  game.flipped = !game.flipped
  for (const [sq, el] of pieces) position(el, sq)
  save()
  render()
}

const save = () => store.set('game', game)

// --- The computer -------------------------------------------------------------------------

function ask() {
  const id = (thinking = ++requests)
  askedAt = performance.now()
  worker.postMessage({ id, moves: game.moves, ...LEVELS[game.opponent as Level], seed: newSeed() } satisfies Request)
}

worker.onmessage = ({ data }: MessageEvent<Reply>) => {
  if (data.id !== thinking) return // a new game or an undo since it was asked
  setTimeout(() => {
    if (data.id !== thinking) return
    thinking = 0
    if (!play(data.move)) render()
  }, MIN_THINK_MS - (performance.now() - askedAt))
}
worker.onerror = () => {
  statusEl.textContent = 'The computer couldn’t start. Reload to try again.'
}

// --- Pieces on the board ------------------------------------------------------------------

function position(el: HTMLElement, sq: number) {
  const c = cellOf(sq)
  el.style.transform = `translate(${(c & 7) * 100}%, ${(c >> 3) * 100}%)`
}

function draw(el: HTMLElement, p: number) {
  el.dataset.p = String(p)
  el.className = `pc ${isBlack(p) ? 'b' : 'w'}`
  el.innerHTML = pieceSvg(kind(p))
}

function placeAll() {
  pieces.clear()
  layer.replaceChildren()
  for (let sq = 0; sq < 64; sq++) {
    const p = rules.piece(sq)
    if (!p) continue
    const el = document.createElement('div')
    draw(el, p)
    position(el, sq)
    layer.append(el)
    pieces.set(sq, el)
  }
}

// Moves the piece elements to match a move, so they slide: the mover, a captured piece
// (behind the mover for en passant), the rook when castling.
function slide(before: number[], m: number) {
  const [f, t] = [from(m), to(m)]
  const passant = kind(before[f]) === PAWN && (f & 7) !== (t & 7) && !before[t]
  const taken = before[t] ? t : passant ? t + (t > f ? -8 : 8) : -1
  const gone = pieces.get(taken)
  if (gone) {
    pieces.delete(taken)
    gone.classList.add('gone')
    setTimeout(() => gone.remove(), 200)
  }
  const shift = (a: number, b: number) => {
    const el = pieces.get(a)
    if (!el) return
    pieces.delete(a)
    pieces.set(b, el)
    position(el, b)
  }
  shift(f, t)
  if (kind(before[f]) === KING && Math.abs((t & 7) - (f & 7)) === 2) shift(t > f ? f + 3 : f - 4, t > f ? f + 1 : f - 1)
  if (promo(m)) draw(pieces.get(t)!, rules.piece(t))
  // If the elements ever disagree with the engine, start over from the engine's board.
  for (let sq = 0; sq < 64; sq++) if ((pieces.get(sq)?.dataset.p ?? '0') !== String(rules.piece(sq))) return placeAll()
}

// --- Drawing everything else --------------------------------------------------------------

let shownMoves = -1
function render() {
  const b = board()
  const side = rules.side()
  const last = game.moves.at(-1)
  const targets = selected >= 0 ? legal().filter(m => from(m) === selected).map(to) : []
  const king = rules.in_check() ? b.findIndex(p => p === (KING | (side ? 8 : 0))) : -1
  cells.forEach((el, c) => {
    const sq = cellOf(c)
    const cls = (sq >> 3) % 2 === (sq & 7) % 2 ? ['dark'] : []
    if (last !== undefined && (sq === from(last) || sq === to(last))) cls.push('last')
    if (sq === selected) cls.push('sel')
    if (targets.includes(sq)) cls.push(b[sq] || (kind(b[selected]) === PAWN && (sq & 7) !== (selected & 7)) ? 'cap' : 'dot')
    if (sq === king) cls.push('check')
    if (sq === cursor) cls.push('cursor')
    if (drag?.moved && sq === drag.over) cls.push('hover')
    el.className = cls.join(' ')
    // Coordinates: ranks down the left edge, files along the bottom.
    if ((c & 7) === 0) el.dataset.rank = String((sq >> 3) + 1)
    else delete el.dataset.rank
    const file = c >> 3 === 7 ? `<s>${'abcdefgh'[sq & 7]}</s>` : ''
    if (el.innerHTML !== file) el.innerHTML = file
  })

  statusEl.textContent = statusText()
  statusEl.classList.toggle('thinking', thinking > 0)

  const { lost, lead } = material(b)
  const player = (el: HTMLElement, color: number) => {
    el.querySelector('b')!.textContent = !vsCpu() ? (color ? 'Black' : 'White') : color === game.human ? 'You' : OPPONENTS[game.opponent]
    const took = color ? lost.white : lost.black
    const ahead = color ? -lead : lead
    el.querySelector('.taken')!.innerHTML =
      took.map(k => `<svg class="${color ? 'w' : 'b'}" viewBox="0 0 100 100"><use href="#p${k}"/></svg>`).join('') +
      (ahead > 0 ? `<small>+${ahead}</small>` : '')
    el.classList.toggle('turn', !ending && side === color)
  }
  player($('#top'), game.flipped ? 0 : 1)
  player($('#bottom'), game.flipped ? 1 : 0)

  if (shownMoves !== sans.length) {
    shownMoves = sans.length
    const move = (n: number) => (n < sans.length ? `<i${n === sans.length - 1 ? ' class="now"' : ''}>${sans[n]}</i>` : '')
    let list = ''
    for (let n = 0; n < sans.length; n += 2) list += `<li><span>${n / 2 + 1}.</span>${move(n)}${move(n + 1)}</li>`
    movesEl.innerHTML = list
    movesEl.scrollLeft = movesEl.scrollWidth
  }
  $<HTMLButtonElement>('#undo').disabled = !canUndo()
}

function statusText() {
  const side = rules.side()
  const name = (c: number) => (c ? 'Black' : 'White')
  if (ending === 1) {
    const winner = 1 - side
    if (!vsCpu()) return `Checkmate. ${name(winner)} wins!`
    return winner === game.human ? 'Checkmate. You win!' : 'Checkmate. The computer wins.'
  }
  if (ending) return ENDINGS[ending]
  const check = rules.in_check() ? 'Check! ' : ''
  if (cpuTurn()) return `${check}Thinking…`
  return check + (vsCpu() ? `Your move (${name(side).toLowerCase()})` : `${name(side)} to move`)
}

// --- Input --------------------------------------------------------------------------------

function squareAt(x: number, y: number) {
  const r = grid.getBoundingClientRect()
  const col = Math.floor(((x - r.left) / r.width) * 8)
  const row = Math.floor(((y - r.top) / r.height) * 8)
  return col < 0 || col > 7 || row < 0 || row > 7 ? -1 : cellOf(row * 8 + col)
}

// A tap (or Enter) on a square: move the piece you hold there, or pick up one of yours.
function activate(sq: number) {
  if (!canMove()) return false
  if (selected >= 0 && selected !== sq && legal().some(m => from(m) === selected && to(m) === sq)) {
    moveTo(selected, sq)
    return false
  }
  const p = rules.piece(sq)
  selected = p && colorOf(p) === rules.side() ? sq : -1
  render()
  return selected >= 0
}

async function moveTo(f: number, t: number) {
  const options = legal().filter(m => from(m) === f && to(m) === t)
  let m = options[0]
  if (options.length > 1) {
    // Several moves between the same squares: a promotion. Ask what the pawn becomes.
    const k = await choosePromotion(rules.side())
    m = options.find(o => promo(o) === k) ?? 0
  }
  if (!m || !play(m)) {
    const el = pieces.get(f)
    if (el) position(el, f)
    render()
  }
}

function choosePromotion(side: number) {
  promoEl.innerHTML = [5, 4, 3, 2]
    .map(k => `<button type="button" class="${side ? 'b' : 'w'}" data-k="${k}" aria-label="${PIECE_NAMES[k]}">${pieceSvg(k)}</button>`)
    .join('')
  promoEl.hidden = false
  promoEl.querySelector('button')!.focus()
  return new Promise<number>(resolve => {
    promoting = k => {
      promoEl.hidden = true
      promoting = null
      resolve(k)
    }
  })
}
promoEl.addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLElement>('[data-k]')
  if (b) promoting?.(Number(b.dataset.k))
})

// Tap a piece, then a square; or drag it. On a touchscreen the dragged piece floats above
// the finger, so you can see where it's going, and it lands on the square it's over.
grid.addEventListener('pointerdown', e => {
  if (promoting) return promoting(0)
  const sq = squareAt(e.clientX, e.clientY)
  if (sq < 0) return
  cursor = -1
  const wasSelected = selected === sq
  if (!activate(sq)) return
  const el = pieces.get(sq)
  if (!el) return
  drag = { sq, el, id: e.pointerId, x: e.clientX, y: e.clientY, lift: e.pointerType === 'touch' ? 0.9 : 0, moved: false, over: -1, wasSelected }
  grid.setPointerCapture(e.pointerId)
})
grid.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
  drag.moved = true
  const r = grid.getBoundingClientRect()
  const cell = r.width / 8
  const lift = drag.lift * cell
  drag.el.classList.add('drag')
  drag.el.style.transform = `translate(${e.clientX - r.left - cell / 2}px, ${e.clientY - r.top - lift - cell / 2}px)`
  const over = squareAt(e.clientX, e.clientY - lift)
  if (over !== drag.over) {
    drag.over = over
    render()
  }
})
function drop(e: PointerEvent, cancelled = false) {
  if (!drag || e.pointerId !== drag.id) return
  const d = drag
  drag = null
  d.el.classList.remove('drag')
  if (d.moved && !cancelled && d.over >= 0 && d.over !== d.sq && legal().some(m => from(m) === d.sq && to(m) === d.over)) {
    moveTo(d.sq, d.over)
  } else {
    position(d.el, d.sq)
    if (!d.moved && d.wasSelected) selected = -1 // tapping the piece you hold puts it down
    render()
  }
}
grid.addEventListener('pointerup', e => drop(e))
grid.addEventListener('pointercancel', e => drop(e, true))
grid.addEventListener('contextmenu', e => e.preventDefault())

const STEP: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return
  if (promoting) {
    if (e.key === 'Escape') promoting(0)
    return
  }
  const step = STEP[e.key]
  if (step) {
    e.preventDefault()
    const c = cellOf(cursor >= 0 ? cursor : selected >= 0 ? selected : game.human && vsCpu() ? 52 : 12)
    const row = Math.min(7, Math.max(0, (c >> 3) + (cursor >= 0 ? step[0] : 0)))
    const col = Math.min(7, Math.max(0, (c & 7) + (cursor >= 0 ? step[1] : 0)))
    cursor = cellOf(row * 8 + col)
    render()
  } else if ((e.key === 'Enter' || e.key === ' ') && cursor >= 0 && !(e.target as Element).closest('button')) {
    e.preventDefault()
    activate(cursor)
  } else if (e.key === 'Escape') {
    selected = -1
    render()
  } else if (e.key === 'u') undo()
  else if (e.key === 'f') flip()
})

$('#undo').onclick = undo
$('#flip').onclick = flip
$('#new').onclick = () => {
  const color = store.get<string>('color', String(game.human))
  for (const input of form.querySelectorAll('input')) input.checked = input.value === (input.name === 'opponent' ? game.opponent : color)
  syncSetup()
  setup.returnValue = '' // closing with Escape leaves it as it was
  setup.showModal()
}
// Your color only matters against the computer.
const syncSetup = () => {
  $<HTMLFieldSetElement>('#colors').disabled = new FormData(form).get('opponent') === 'friend'
}
form.addEventListener('change', syncSetup)
setup.addEventListener('close', () => {
  if (setup.returnValue !== 'start') return
  const data = new FormData(form)
  const color = String(data.get('color') ?? '0')
  store.set('color', color)
  newGame(data.get('opponent') as Opponent, color === 'random' ? newSeed() & 1 : Number(color))
})

// --- Start: pick up the saved game where it was left ----------------------------------------

const saved = store.get<Partial<Game>>('game', {})
if (saved.opponent && saved.opponent in OPPONENTS) game.opponent = saved.opponent
game.human = saved.human === 1 ? 1 : 0
game.flipped = !!saved.flipped
rules.reset()
for (const m of Array.isArray(saved.moves) ? saved.moves : []) if (!record(m)) break
placeAll()
render()
if (cpuTurn()) ask()
