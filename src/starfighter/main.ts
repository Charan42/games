import { mountBar } from '../shared/bar.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { addEvents, draw, effects } from './draw.ts'
import { H, TICKS, W, init, step, type Controls, type State } from './logic.ts'
import meta from './meta.ts'

const TICK_MS = 1000 / TICKS
const MAX_MOVE = 14 // the field pixels a ship may cover in a tick (the rules enforce it too)
const SENSITIVITY = 1.15 // ship pixels per finger pixel: a little more, so the thumb travels less

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!
const canvas = document.querySelector('canvas')!
const ctx = canvas.getContext('2d')!
const board = canvas.parentElement!
const overlay = document.querySelector<HTMLButtonElement>('.overlay')!
const bombButton = document.querySelector<HTMLButtonElement>('#bomb')!

let s: State = init(newSeed())
let prev = s
let fx = effects()
let mode: 'ready' | 'playing' | 'paused' | 'over' = 'ready'
let best = store.get('best', 0)
let scale = 1
let lag = 0
let last = performance.now()
const pending = { x: 0, y: 0 } // finger movement not yet flown, in field pixels
let bombQueued = false
const held = new Set<string>()

mountBar(meta, pause)

// The field keeps its 9:16 shape, as large as fits.
new ResizeObserver(() => {
  scale = Math.min(board.clientWidth / W, board.clientHeight / H)
  const dpr = Math.min(devicePixelRatio, 2)
  canvas.style.width = `${W * scale}px`
  canvas.style.height = `${H * scale}px`
  canvas.width = Math.round(W * scale * dpr)
  canvas.height = Math.round(H * scale * dpr)
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
}).observe(board)

function start() {
  if (mode === 'over' || mode === 'ready') {
    s = prev = init(newSeed())
    fx = effects()
  }
  mode = 'playing'
  overlay.hidden = true
  lag = 0
  pending.x = pending.y = 0
}

function pause() {
  if (mode !== 'playing') return
  mode = 'paused'
  show('Paused', 'Tap to carry on')
}

function show(title: string, ...lines: string[]) {
  overlay.innerHTML = '<strong></strong>'
  overlay.querySelector('strong')!.textContent = title
  lines.forEach((line, i) => {
    const span = document.createElement('span')
    span.textContent = line
    if (i === lines.length - 1) span.className = 'go'
    overlay.append(span)
  })
  overlay.hidden = false
}

function gameOver() {
  mode = 'over'
  const record = s.score > best
  if (record) store.set('best', (best = s.score))
  show(record ? 'New best!' : 'Game over', `Score ${s.score.toLocaleString()} · stage ${s.stage}`, `${s.graze} grazes`, 'Tap to play again')
}

// --- Input: drag anywhere to fly; a second finger bombs ---------------------------------------

const play = $('main')
const fingers = new Map<number, { x: number; y: number }>()
let lead = -1 // the finger that flies the ship
play.addEventListener('pointerdown', e => {
  if ((e.target as Element).closest('button')) return
  if (mode === 'paused') start()
  if (mode !== 'playing') return
  if (fingers.size) bombQueued = true
  else lead = e.pointerId
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try {
    play.setPointerCapture(e.pointerId) // keep flying if a mouse leaves the page
  } catch {
    // the pointer is already gone; its moves won't come anyway
  }
})
play.addEventListener('pointermove', e => {
  const f = fingers.get(e.pointerId)
  if (!f || e.pointerId !== lead) return
  pending.x += ((e.clientX - f.x) / scale) * SENSITIVITY
  pending.y += ((e.clientY - f.y) / scale) * SENSITIVITY
  f.x = e.clientX
  f.y = e.clientY
})
const lift = (e: PointerEvent) => {
  fingers.delete(e.pointerId)
  if (e.pointerId === lead) lead = -1
}
play.addEventListener('pointerup', lift)
play.addEventListener('pointercancel', lift)
play.addEventListener('contextmenu', e => e.preventDefault())
overlay.onclick = start
bombButton.addEventListener('pointerdown', e => {
  e.preventDefault()
  if (mode === 'playing') bombQueued = true
})

const KEYS: Record<string, string> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'slow', ShiftRight: 'slow',
}
addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return
  if (KEYS[e.code]) {
    held.add(KEYS[e.code])
    if (mode === 'ready' || mode === 'paused') start()
    e.preventDefault()
  } else if (e.code === 'KeyX' || e.code === 'Space') {
    e.preventDefault()
    if (mode === 'playing') bombQueued = true
    else start()
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (mode === 'playing') pause()
    else if (mode === 'paused') start()
  }
})
addEventListener('keyup', e => KEYS[e.code] && held.delete(KEYS[e.code]))
document.addEventListener('visibilitychange', () => document.hidden && pause())
addEventListener('blur', pause)

// This tick's controls: held keys, plus as much of the finger's movement as a tick allows.
function controls(): Controls {
  const speed = held.has('slow') ? 2.2 : 4.6
  let dx = (held.has('right') ? speed : 0) - (held.has('left') ? speed : 0)
  let dy = (held.has('down') ? speed : 0) - (held.has('up') ? speed : 0)
  const len = Math.hypot(pending.x, pending.y)
  const k = len > MAX_MOVE ? MAX_MOVE / len : 1
  dx += pending.x * k
  dy += pending.y * k
  pending.x -= pending.x * k
  pending.y -= pending.y * k
  // Don't keep pushing into the edge of the field, or catching up on a flick forever.
  const left = Math.hypot(pending.x, pending.y)
  if (left > 60) (pending.x *= 60 / left), (pending.y *= 60 / left)
  const bomb = bombQueued
  bombQueued = false
  return { dx, dy, bomb }
}

// --- The loop ------------------------------------------------------------------------------

function frame(now: number) {
  const dt = Math.min(100, now - last)
  last = now
  if (mode === 'playing') {
    lag = Math.min(lag + dt, 200)
    while (lag >= TICK_MS && mode === 'playing') {
      lag -= TICK_MS
      prev = s
      s = step(s, controls())
      addEvents(fx, s.events, s)
      for (const e of s.events) {
        if (e.type === 'death') navigator.vibrate?.(120)
        else if (e.type === 'bomb') navigator.vibrate?.(40)
      }
      if (s.over) gameOver()
    }
    // Pinned against a wall: forget movement the ship couldn't make.
    if (s.player.x <= 10 || s.player.x >= W - 10) pending.x = 0
    if (s.player.y <= 24 || s.player.y >= H - 16) pending.y = 0
  }
  draw(ctx, s, prev, mode === 'playing' ? lag / TICK_MS : 1, fx, now, dt / TICK_MS)
  hud()
  requestAnimationFrame(frame)
}

let shown = ''
function hud() {
  const p = s.player
  const key = `${s.score}|${s.stage}|${p.lives}|${p.bombs}|${best}|${s.chain}|${s.graze}`
  if (key === shown) return
  shown = key
  $('#score').textContent = s.score.toLocaleString()
  $('#stage').textContent = String(s.stage)
  $('#lives').textContent = '▲'.repeat(Math.max(0, Math.min(p.lives, 8)))
  $('#best').textContent = Math.max(best, s.score).toLocaleString()
  $('#bombs').textContent = String(p.bombs)
  bombButton.disabled = p.bombs === 0
  $('#chain').textContent = s.chain > 1 ? `Chain ×${s.chain} · Graze ${s.graze}` : `Graze ${s.graze}`
}

requestAnimationFrame(frame)
