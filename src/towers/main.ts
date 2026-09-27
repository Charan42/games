import { mountBar } from '../shared/bar.ts'
import { fitCanvas } from '../shared/canvas.ts'
import { store } from '../shared/storage.ts'
import {
  COLS, MAX_LEVEL, ON_PATH, PATH_LENGTH, ROWS, TICKS_PER_SECOND, TOWERS, along, build, callWave, canBuild,
  earlyBonus, init, refund, sell, stats, step, towerAt, upgrade, upgradeCost, type EnemyKind, type State, type TowerKind,
} from './logic.ts'
import meta from './meta.ts'

const TOWER_COLOR: Record<TowerKind, string> = { gun: '#facc15', cannon: '#fb923c', frost: '#67e8f9', sniper: '#e879f9' }
const ENEMY: Record<EnemyKind, { color: string; size: number }> = {
  grunt: { color: '#f87171', size: 0.26 },
  runner: { color: '#fde047', size: 0.2 },
  tank: { color: '#a78bfa', size: 0.34 },
  boss: { color: '#f43f5e', size: 0.44 },
}
const TICK_MS = 1000 / TICKS_PER_SECOND
const KINDS = Object.keys(TOWERS) as TowerKind[]

const canvas = document.querySelector('canvas')!
const overlay = document.querySelector<HTMLButtonElement>('.overlay')!
const toolsEl = document.querySelector<HTMLElement>('#tools')!
const selectedEl = document.querySelector<HTMLElement>('#selected')!
const $ = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!

let state: State = init()
let mode: 'playing' | 'paused' | 'over' = 'playing'
let tool: TowerKind = 'gun'
let selected = -1 // cell of the tower being looked at
let fast = false
let best = store.get('best', 0)
let last = performance.now()
let lag = 0

mountBar(meta, pause)
const view = fitCanvas(canvas, COLS, ROWS, draw)
toolsEl.innerHTML = KINDS.map(
  k => `<button type="button" class="chip" data-kind="${k}" title="${TOWERS[k].blurb}"><i class="dot" style="--c: ${TOWER_COLOR[k]}"></i>${TOWERS[k].name} <small>${TOWERS[k].cost}</small></button>`,
).join('')
toolsEl.onclick = e => {
  const b = (e.target as Element).closest<HTMLElement>('[data-kind]')
  if (b) [tool, selected] = [b.dataset.kind as TowerKind, -1]
  ui()
}
$('upgrade').onclick = () => act(upgrade(state, selected))
$('sell').onclick = () => {
  act(sell(state, selected))
  selected = -1
  ui()
}
$('close').onclick = () => {
  selected = -1
  ui()
}
$('call').onclick = () => act(callWave(state))
$('speed').onclick = () => {
  fast = !fast
  ui()
}
overlay.onclick = () => (mode === 'over' ? restart() : resume())
document.addEventListener('visibilitychange', () => document.hidden && pause())
addEventListener('blur', pause)

function act(next: State) {
  if (next === state) return navigator.vibrate?.(40)
  state = next
  ui()
  draw()
}

canvas.addEventListener('pointerdown', e => {
  if (mode !== 'playing') return
  const r = canvas.getBoundingClientRect()
  const cell = Math.floor(((e.clientY - r.top) / r.height) * ROWS) * COLS + Math.floor(((e.clientX - r.left) / r.width) * COLS)
  if (towerAt(state, cell)) selected = selected === cell ? -1 : cell
  else if (canBuild(state, cell, tool)) {
    selected = -1
    act(build(state, cell, tool))
  } else {
    selected = -1
    if (!ON_PATH.has(cell)) navigator.vibrate?.(40) // can't afford it
  }
  ui()
  draw()
})
canvas.addEventListener('contextmenu', e => e.preventDefault())

addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return
  const n = Number(e.key)
  if (n >= 1 && n <= KINDS.length) [tool, selected] = [KINDS[n - 1], -1]
  else if (e.key === 'n') act(callWave(state))
  else if (e.key === 'f') fast = !fast
  else if (e.key === 'u' && selected >= 0) act(upgrade(state, selected))
  else if (e.key === 'Escape') selected = -1
  else return
  ui()
})

function restart() {
  state = init()
  selected = -1
  mode = 'playing'
  overlay.hidden = true
  last = performance.now()
  requestAnimationFrame(frame)
  ui()
}

function pause() {
  if (mode !== 'playing') return
  mode = 'paused'
  show('Paused', 'Tap to carry on')
}

function resume() {
  if (mode !== 'paused') return
  mode = 'playing'
  overlay.hidden = true
  last = performance.now()
  lag = 0
  requestAnimationFrame(frame)
}

function show(title: string, hint: string) {
  overlay.innerHTML = '<strong></strong><span></span>'
  overlay.querySelector('strong')!.textContent = title
  overlay.querySelector('span')!.textContent = hint
  overlay.hidden = false
}

function frame(now: number) {
  if (mode !== 'playing') return
  lag = Math.min(lag + (now - last) * (fast ? 2 : 1), 500)
  last = now
  const before = state
  while (lag >= TICK_MS) {
    lag -= TICK_MS
    state = step(state)
  }
  if (state.lives < before.lives) navigator.vibrate?.(60)
  if (state.over) {
    mode = 'over'
    if (state.wave > best) store.set('best', (best = state.wave))
    show('Overrun', `You held ${state.wave - 1} wave${state.wave === 2 ? '' : 's'} · tap to play again`)
  } else requestAnimationFrame(frame)
  ui()
  draw()
}

// Buttons and numbers under the board. Only touches the DOM when something changed.
let shown = ''
function ui() {
  const t = selected >= 0 ? towerAt(state, selected) : undefined
  if (!t) selected = -1
  const key = JSON.stringify([state.gold, state.lives, state.wave, earlyBonus(state), tool, selected, t?.level, fast, best])
  if (key === shown) return
  shown = key
  $('lives').textContent = String(state.lives)
  $('gold').textContent = String(state.gold)
  $('wave').textContent = String(state.wave)
  $('best').textContent = String(best)
  for (const b of toolsEl.querySelectorAll<HTMLElement>('[data-kind]')) {
    b.setAttribute('aria-pressed', String(b.dataset.kind === tool))
    b.classList.toggle('poor', state.gold < TOWERS[b.dataset.kind as TowerKind].cost)
  }
  toolsEl.hidden = !!t
  selectedEl.hidden = !t
  if (t) {
    const s = stats(t.kind, t.level)
    $('info').textContent = `${TOWERS[t.kind].name} ${'★'.repeat(t.level)} · ${s.damage} dmg`
    const up = $('upgrade') as HTMLButtonElement
    up.textContent = t.level >= MAX_LEVEL ? 'Max level' : `Upgrade ${upgradeCost(t)}`
    up.disabled = t.level >= MAX_LEVEL || state.gold < upgradeCost(t)
    $('sell').textContent = `Sell +${refund(t)}`
  }
  $('call').textContent = `Next wave +${earlyBonus(state)}`
  $('speed').setAttribute('aria-pressed', String(fast))
}

function draw() {
  const { ctx, cell } = view
  const px = (v: number) => v * cell
  // Grass, checkered, and the road.
  ctx.fillStyle = '#17291c'
  ctx.fillRect(0, 0, px(COLS), px(ROWS))
  ctx.fillStyle = '#1b3021'
  for (let y = 0; y < ROWS; y++) for (let x = y % 2; x < COLS; x += 2) ctx.fillRect(px(x), px(y), cell, cell)
  ctx.lineCap = 'square'
  ctx.lineJoin = 'round'
  for (const [width, color] of [[0.86, '#2a2418'], [0.72, '#4a3f2b']] as const) {
    ctx.beginPath()
    for (let d = 0; d <= PATH_LENGTH; d += 0.5) {
      const [x, y] = along(d)
      ctx[d ? 'lineTo' : 'moveTo'](px(x), px(y))
    }
    ctx.strokeStyle = color
    ctx.lineWidth = px(width)
    ctx.stroke()
  }

  // Range of the tower being looked at.
  const t = selected >= 0 ? towerAt(state, selected) : undefined
  if (t) {
    ctx.beginPath()
    ctx.arc(px((t.cell % COLS) + 0.5), px(Math.floor(t.cell / COLS) + 0.5), px(stats(t.kind, t.level).range), 0, Math.PI * 2)
    ctx.fillStyle = 'rgb(255 255 255 / 0.08)'
    ctx.fill()
    ctx.strokeStyle = 'rgb(255 255 255 / 0.4)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  for (const tw of state.towers) {
    const [x, y] = [px((tw.cell % COLS) + 0.5), px(Math.floor(tw.cell / COLS) + 0.5)]
    ctx.fillStyle = '#2b303b'
    ctx.beginPath()
    ctx.roundRect(x - px(0.42), y - px(0.42), px(0.84), px(0.84), px(0.18))
    ctx.fill()
    ctx.strokeStyle = TOWER_COLOR[tw.kind]
    ctx.lineWidth = px(tw.kind === 'sniper' ? 0.1 : 0.16)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(tw.angle) * px(0.38), y + Math.sin(tw.angle) * px(0.38))
    ctx.stroke()
    ctx.fillStyle = TOWER_COLOR[tw.kind]
    ctx.beginPath()
    ctx.arc(x, y, px(tw.kind === 'cannon' ? 0.24 : 0.19), 0, Math.PI * 2)
    ctx.fill()
    for (let l = 0; l < tw.level; l++) {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(x - px(0.24) + px(0.24) * l, y + px(0.32), px(0.05), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  for (const e of state.enemies) {
    const [x, y] = along(e.d).map(px)
    const { color, size } = ENEMY[e.kind]
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, px(size), 0, Math.PI * 2)
    ctx.fill()
    if (e.armor > 0) {
      ctx.strokeStyle = 'rgb(226 232 240 / 0.8)'
      ctx.lineWidth = px(0.05)
      ctx.stroke()
    }
    if (e.slow > 0) {
      ctx.strokeStyle = '#67e8f9'
      ctx.lineWidth = px(0.07)
      ctx.beginPath()
      ctx.arc(x, y, px(size + 0.07), 0, Math.PI * 2)
      ctx.stroke()
    }
    if (e.hp < e.maxHp) {
      const w = px(size * 2)
      ctx.fillStyle = '#000a'
      ctx.fillRect(x - w / 2, y - px(size + 0.18), w, px(0.08))
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(x - w / 2, y - px(size + 0.18), (w * e.hp) / e.maxHp, px(0.08))
    }
  }

  for (const s of state.shots) {
    const [x0, y0] = s.from.map(px)
    const [x1, y1] = s.to.map(px)
    ctx.globalAlpha = Math.min(1, s.t / 6)
    if (s.kind === 'cannon') {
      ctx.fillStyle = '#fb923c'
      ctx.beginPath()
      ctx.arc(x1, y1, px(1.1) * (1 - s.t / 10), 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = TOWER_COLOR[s.kind]
      ctx.lineWidth = px(s.kind === 'sniper' ? 0.08 : 0.05)
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}

ui()
requestAnimationFrame(frame)
