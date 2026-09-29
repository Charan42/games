// Drawing the dungeon on a canvas: tiles lit by the player's torch, remembered places in cold
// grey, monsters as letters, items as little pictures, and the effects of a turn (damage
// numbers, arrows, fire, sparks). Nothing here affects play, so it may use Math.random.
import { MONSTERS, POTION_LOOKS, type Item } from './data.ts'
import { DOOR, H, OPEN, STAIRS, W, WALL } from './gen.ts'
import type { Event, State } from './logic.ts'

export interface Camera { x: number; y: number } // the tile at the center of the view, fractional

export interface Effects {
  floats: { i: number; text: string; color: string; born: number }[]
  flashes: { i: number; color: string; born: number }[]
  shots: { from: number; to: number; color: string; born: number }[]
  sparks: { x: number; y: number; vx: number; vy: number; color: string; born: number; life: number }[]
  rings: { i: number; color: string; born: number }[]
  fade: number // when the last descent started
  shake: number // when the last heavy hit landed
}
export const noEffects = (): Effects => ({ floats: [], flashes: [], shots: [], sparks: [], rings: [], fade: -1e9, shake: -1e9 })

const FLOAT_MS = 800
const SHOT_MS = 160
const busyUntil = (fx: Effects) =>
  Math.max(
    ...fx.floats.map(f => f.born + FLOAT_MS),
    ...fx.shots.map(f => f.born + SHOT_MS),
    ...fx.sparks.map(f => f.born + f.life),
    ...fx.rings.map(f => f.born + 600),
    ...fx.flashes.map(f => f.born + 250),
    fx.fade + 450,
    fx.shake + 250,
  )
export const animating = (fx: Effects, now: number) => busyUntil(fx) > now

// Turns a step's events into effects to play.
export function addEvents(fx: Effects, s: State, events: Event[], now: number) {
  const you = s.player.y * W + s.player.x
  for (const e of events) {
    if (e.type === 'hit') {
      const mine = e.at === you
      fx.floats.push({ i: e.at, text: String(e.amount), color: mine ? '#f87171' : e.crit ? '#fde047' : '#f8fafc', born: now })
      fx.flashes.push({ i: e.at, color: mine ? '#ef4444' : '#ffffff', born: now })
      if (mine && e.amount >= s.player.maxHp * 0.2) fx.shake = now
    } else if (e.type === 'miss') {
      fx.floats.push({ i: e.at, text: 'miss', color: '#94a3b8', born: now })
    } else if (e.type === 'die') {
      burst(fx, e.at, e.color, 14, now)
    } else if (e.type === 'shot') {
      fx.shots.push({ from: e.from, to: e.to, color: e.color, born: now })
    } else if (e.type === 'burn') {
      for (const i of e.at) burst(fx, i, '#fb923c', 18, now)
    } else if (e.type === 'heal') {
      fx.rings.push({ i: e.at, color: '#4ade80', born: now })
    } else if (e.type === 'level') {
      fx.rings.push({ i: you, color: '#fde047', born: now })
    } else if (e.type === 'descend') {
      fx.fade = now
    }
  }
}

function burst(fx: Effects, i: number, color: string, n: number, now: number) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2
    const v = 0.6 + Math.random() * 1.6
    fx.sparks.push({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, born: now, life: 350 + Math.random() * 250 })
  }
}

// Cheap, stable per-tile noise, so floors look worn rather than flat.
const noise = (i: number) => (((i * 2654435761) >>> 0) % 1000) / 1000

function rgb(hex: string, light: number, tint: readonly [number, number, number]) {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number, t: number) => Math.round(Math.min(255, v * light * t))
  return `rgb(${c(n >> 16, tint[0])} ${c((n >> 8) & 255, tint[1])} ${c(n & 255, tint[2])})`
}
const TORCH = [1.05, 0.95, 0.8] as const
const MEMORY = [0.55, 0.65, 0.95] as const

export function drawWorld(ctx: CanvasRenderingContext2D, w: number, h: number, T: number, cam: Camera, s: State, fx: Effects, now: number) {
  ctx.fillStyle = '#07080b'
  ctx.fillRect(0, 0, w, h)
  let ox = w / 2 - cam.x * T
  let oy = h / 2 - cam.y * T
  const shaking = now - fx.shake
  if (shaking < 250) {
    const k = (1 - shaking / 250) * T * 0.12
    ox += (Math.random() - 0.5) * 2 * k
    oy += (Math.random() - 0.5) * 2 * k
  }
  const x0 = Math.max(0, Math.floor(-ox / T))
  const x1 = Math.min(W - 1, Math.ceil((w - ox) / T))
  const y0 = Math.max(0, Math.floor(-oy / T))
  const y1 = Math.min(H - 1, Math.ceil((h - oy) / T))
  const p = s.player
  const radius = p.blind > 0 ? 1.5 : 7.5

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x
      if (!s.seen[i]) continue
      const lit = s.visible[i] === 1
      const d = Math.hypot(x - p.x, y - p.y)
      const light = lit ? 1 - 0.55 * Math.min(1, d / radius) ** 1.5 : 0.26
      const tint = lit ? TORCH : MEMORY
      tile(ctx, s, i, ox + x * T, oy + y * T, T, light, tint)
    }
  }

  for (const { at, item } of s.items) {
    if (!s.seen[at]) continue
    ctx.globalAlpha = s.visible[at] ? 1 : 0.45
    drawItem(ctx, s, item, ox + (at % W) * T, oy + Math.floor(at / W) * T, T, now)
  }
  ctx.globalAlpha = 1

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const m of s.monsters) {
    const i = m.y * W + m.x
    if (!s.visible[i]) continue
    const t = MONSTERS[m.kind]
    const [cx, cy] = [ox + (m.x + 0.5) * T, oy + (m.y + 0.5) * T]
    glyph(ctx, t.glyph, t.color, cx, cy, T * (m.kind === 'dragon' ? 0.95 : 0.78))
    if (!m.awake) {
      ctx.font = `600 ${T * 0.3}px system-ui, sans-serif`
      ctx.fillStyle = `rgb(186 230 253 / ${0.5 + 0.4 * Math.sin(now / 400)})`
      ctx.fillText('z', cx + T * 0.34, cy - T * 0.34 - (now / 60) % 3)
    }
    if (m.hp < m.maxHp) {
      const bw = T * 0.72
      ctx.fillStyle = 'rgb(0 0 0 / 0.7)'
      ctx.fillRect(cx - bw / 2, cy + T * 0.38, bw, T * 0.09)
      ctx.fillStyle = m.hp / m.maxHp > 0.5 ? '#4ade80' : m.hp / m.maxHp > 0.25 ? '#facc15' : '#ef4444'
      ctx.fillRect(cx - bw / 2, cy + T * 0.38, (bw * Math.max(0, m.hp)) / m.maxHp, T * 0.09)
    }
  }

  // You: a bright @, reddening as your health runs out.
  const hurt = 1 - p.hp / p.maxHp
  const pc = hurt > 0.66 ? '#fca5a5' : '#fef3c7'
  ctx.shadowColor = 'rgb(253 230 138 / 0.8)'
  ctx.shadowBlur = T * 0.35
  glyph(ctx, '@', pc, ox + (p.x + 0.5) * T, oy + (p.y + 0.5) * T, T * 0.8)
  ctx.shadowBlur = 0

  drawEffects(ctx, fx, ox, oy, T, now)

  // A soft vignette, darkest at the edges.
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
  g.addColorStop(0, 'rgb(0 0 0 / 0)')
  g.addColorStop(1, 'rgb(0 0 0 / 0.55)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  const fading = (now - fx.fade) / 450
  if (fading < 1) {
    ctx.fillStyle = `rgb(0 0 0 / ${1 - fading})`
    ctx.fillRect(0, 0, w, h)
  }
}

function glyph(ctx: CanvasRenderingContext2D, ch: string, color: string, x: number, y: number, size: number) {
  ctx.font = `800 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace`
  ctx.lineWidth = size * 0.16
  ctx.strokeStyle = 'rgb(0 0 0 / 0.75)'
  ctx.strokeText(ch, x, y + size * 0.04)
  ctx.fillStyle = color
  ctx.fillText(ch, x, y + size * 0.04)
}

function tile(ctx: CanvasRenderingContext2D, s: State, i: number, x: number, y: number, T: number, light: number, tint: readonly [number, number, number]) {
  const t = s.tiles[i]
  const n = noise(i)
  const px = Math.max(1, T * 0.04)
  if (t === WALL) {
    // Dark stone seen from above; where a room lies below, its lit face with a course of bricks.
    ctx.fillStyle = rgb('#2b2724', light * (0.9 + n * 0.15), tint)
    ctx.fillRect(x, y, T + 0.5, T + 0.5)
    const below = i + W < W * H ? s.tiles[i + W] : WALL
    if (below !== WALL && s.seen[i + W]) {
      ctx.fillStyle = rgb('#6d6258', light, tint)
      ctx.fillRect(x, y + T * 0.5, T + 0.5, T * 0.5 + 0.5)
      ctx.fillStyle = rgb('#8c8074', light, tint)
      ctx.fillRect(x, y + T * 0.5, T + 0.5, px)
      ctx.fillStyle = rgb('#463e37', light, tint)
      ctx.fillRect(x, y + T * 0.75, T + 0.5, px)
      ctx.fillRect(x + T * (0.2 + n * 0.3), y + T * 0.5, px, T * 0.25)
      ctx.fillRect(x + T * (0.55 + n * 0.3), y + T * 0.75, px, T * 0.25)
    }
    return
  }
  // Flagstones: a slightly varied slab with a darker seam along two edges.
  ctx.fillStyle = rgb('#5b5046', light * (0.9 + n * 0.16), tint)
  ctx.fillRect(x, y, T + 0.5, T + 0.5)
  ctx.fillStyle = rgb('#40372f', light, tint)
  ctx.fillRect(x, y, T + 0.5, px)
  ctx.fillRect(x, y, px, T + 0.5)
  if (n > 0.8) {
    ctx.fillStyle = rgb('#4a4037', light, tint)
    ctx.fillRect(x + T * (0.2 + n * 0.4), y + T * (0.3 + (1 - n) * 1.5), T * 0.12, T * 0.12)
  }
  if (t === DOOR) {
    ctx.fillStyle = rgb('#8a5a2b', light, tint)
    ctx.fillRect(x + T * 0.12, y + T * 0.06, T * 0.76, T * 0.9)
    ctx.fillStyle = rgb('#5c3a1a', light, tint)
    ctx.fillRect(x + T * 0.37, y + T * 0.06, T * 0.03, T * 0.9)
    ctx.fillRect(x + T * 0.62, y + T * 0.06, T * 0.03, T * 0.9)
    ctx.fillStyle = rgb('#facc15', light, tint)
    ctx.fillRect(x + T * 0.7, y + T * 0.5, T * 0.08, T * 0.08)
  } else if (t === OPEN) {
    ctx.fillStyle = rgb('#5c3a1a', light, tint)
    ctx.fillRect(x + T * 0.04, y, T * 0.1, T)
    ctx.fillRect(x + T * 0.86, y, T * 0.1, T)
  } else if (t === STAIRS) {
    ctx.fillStyle = rgb('#15120f', light, tint)
    ctx.fillRect(x + T * 0.1, y + T * 0.1, T * 0.8, T * 0.8)
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = rgb('#b9b0a4', light * (1 - k * 0.2), tint)
      ctx.fillRect(x + T * (0.14 + k * 0.06), y + T * (0.14 + k * 0.19), T * (0.72 - k * 0.12), T * 0.12)
    }
  }
}

export function drawItem(ctx: CanvasRenderingContext2D, s: State, item: Item, x: number, y: number, T: number, now: number) {
  const cx = x + T / 2
  const cy = y + T / 2
  const u = T / 10
  ctx.lineWidth = Math.max(1, u * 0.5)
  ctx.strokeStyle = 'rgb(0 0 0 / 0.6)'
  switch (item.kind) {
    case 'potion': {
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(cx - u * 0.8, cy - u * 3.4, u * 1.6, u * 1.8)
      ctx.beginPath()
      ctx.arc(cx, cy + u * 0.6, u * 2.4, 0, Math.PI * 2)
      ctx.fillStyle = POTION_LOOKS[s.looks.potions[item.type]].color
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgb(255 255 255 / 0.55)'
      ctx.beginPath()
      ctx.arc(cx - u * 0.8, cy - u * 0.2, u * 0.6, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'scroll':
      ctx.fillStyle = '#e7d7b1'
      ctx.fillRect(cx - u * 2.6, cy - u * 1.8, u * 5.2, u * 3.6)
      ctx.strokeRect(cx - u * 2.6, cy - u * 1.8, u * 5.2, u * 3.6)
      ctx.fillStyle = '#b89b64'
      ctx.fillRect(cx - u * 3.1, cy - u * 2.1, u * 1, u * 4.2)
      ctx.fillRect(cx + u * 2.1, cy - u * 2.1, u * 1, u * 4.2)
      ctx.fillStyle = '#7c6a48'
      for (let k = 0; k < 3; k++) ctx.fillRect(cx - u * 1.5, cy - u * 1 + k * u * 0.9, u * 3, u * 0.35)
      break
    case 'gold':
      for (const [dx, dy] of [[-1.3, 0.9], [1.2, 1], [0, -0.4]]) {
        ctx.beginPath()
        ctx.ellipse(cx + dx * u, cy + dy * u, u * 1.7, u * 1.2, 0, 0, Math.PI * 2)
        ctx.fillStyle = '#facc15'
        ctx.fill()
        ctx.stroke()
      }
      break
    case 'weapon':
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-Math.PI / 4)
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(-u * 0.6, -u * 4, u * 1.2, u * 5.4)
      ctx.fillStyle = '#a16207'
      ctx.fillRect(-u * 2, u * 1.2, u * 4, u * 0.9)
      ctx.fillRect(-u * 0.5, u * 2, u, u * 1.8)
      ctx.restore()
      break
    case 'armor':
      ctx.beginPath()
      ctx.moveTo(cx - u * 3, cy - u * 3)
      ctx.lineTo(cx + u * 3, cy - u * 3)
      ctx.lineTo(cx + u * 2.6, cy + u * 1)
      ctx.quadraticCurveTo(cx, cy + u * 4, cx - u * 2.6, cy + u * 1)
      ctx.closePath()
      ctx.fillStyle = '#94a3b8'
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(cx - u * 0.4, cy - u * 2.6, u * 0.8, u * 4.4)
      break
    case 'amulet': {
      ctx.strokeStyle = '#fde68a'
      ctx.beginPath()
      ctx.arc(cx, cy - u * 1.5, u * 2.2, Math.PI * 1.1, Math.PI * 1.9)
      ctx.stroke()
      ctx.shadowColor = '#c084fc'
      ctx.shadowBlur = T * (0.4 + 0.2 * Math.sin(now / 300))
      ctx.fillStyle = '#a855f7'
      ctx.beginPath()
      ctx.moveTo(cx, cy - u * 2)
      ctx.lineTo(cx + u * 2, cy + u * 0.5)
      ctx.lineTo(cx, cy + u * 3)
      ctx.lineTo(cx - u * 2, cy + u * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
      break
    }
  }
}

function drawEffects(ctx: CanvasRenderingContext2D, fx: Effects, ox: number, oy: number, T: number, now: number) {
  const pos = (i: number): [number, number] => [ox + ((i % W) + 0.5) * T, oy + (Math.floor(i / W) + 0.5) * T]
  fx.flashes = fx.flashes.filter(f => now - f.born < 250)
  for (const f of fx.flashes) {
    ctx.globalAlpha = 0.45 * (1 - (now - f.born) / 250)
    ctx.fillStyle = f.color
    ctx.fillRect(ox + (f.i % W) * T, oy + Math.floor(f.i / W) * T, T, T)
  }
  ctx.globalAlpha = 1
  fx.shots = fx.shots.filter(f => now - f.born < SHOT_MS)
  for (const f of fx.shots) {
    const k = (now - f.born) / SHOT_MS
    const [ax, ay] = pos(f.from)
    const [bx, by] = pos(f.to)
    const [hx, hy] = [ax + (bx - ax) * k, ay + (by - ay) * k]
    const [tx, ty] = [ax + (bx - ax) * Math.max(0, k - 0.25), ay + (by - ay) * Math.max(0, k - 0.25)]
    ctx.strokeStyle = f.color
    ctx.lineWidth = T * 0.08
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(hx, hy)
    ctx.stroke()
  }
  fx.sparks = fx.sparks.filter(f => now - f.born < f.life)
  for (const f of fx.sparks) {
    const t = (now - f.born) / 1000
    ctx.globalAlpha = 1 - (now - f.born) / f.life
    ctx.fillStyle = f.color
    const size = T * 0.1
    ctx.fillRect(ox + (f.x + f.vx * t) * T - size / 2, oy + (f.y + f.vy * t + 1.5 * t * t) * T - size / 2, size, size)
  }
  fx.rings = fx.rings.filter(f => now - f.born < 600)
  for (const f of fx.rings) {
    const k = (now - f.born) / 600
    const [cx, cy] = pos(f.i)
    ctx.globalAlpha = 1 - k
    ctx.strokeStyle = f.color
    ctx.lineWidth = T * 0.08
    ctx.beginPath()
    ctx.arc(cx, cy, T * (0.3 + k * 1.2), 0, Math.PI * 2)
    ctx.stroke()
  }
  fx.floats = fx.floats.filter(f => now - f.born < FLOAT_MS)
  ctx.font = `800 ${T * 0.42}px system-ui, sans-serif`
  ctx.lineWidth = T * 0.08
  for (const f of fx.floats) {
    const k = (now - f.born) / FLOAT_MS
    const [cx, cy] = pos(f.i)
    ctx.globalAlpha = 1 - k * k
    ctx.strokeStyle = 'rgb(0 0 0 / 0.8)'
    ctx.strokeText(f.text, cx, cy - T * (0.35 + k * 0.7))
    ctx.fillStyle = f.color
    ctx.fillText(f.text, cx, cy - T * (0.35 + k * 0.7))
  }
  ctx.globalAlpha = 1
}

// The whole floor as far as you know it, to glance at or tap to travel.
export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, s: State) {
  const k = Math.min(w / W, h / H) * 0.96
  const [ox, oy] = [(w - k * W) / 2, (h - k * H) / 2]
  ctx.fillStyle = 'rgb(5 6 9 / 0.94)'
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < W * H; i++) {
    if (!s.seen[i]) continue
    const t = s.tiles[i]
    ctx.fillStyle = t === WALL ? '#57534e' : t === STAIRS ? '#f8fafc' : t === DOOR || t === OPEN ? '#a16207' : s.visible[i] ? '#3f3a33' : '#26231f'
    ctx.fillRect(ox + (i % W) * k, oy + Math.floor(i / W) * k, k + 0.5, k + 0.5)
  }
  const dot = (i: number, color: string, r: number) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(ox + ((i % W) + 0.5) * k, oy + (Math.floor(i / W) + 0.5) * k, k * r, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const { at, item } of s.items) if (s.seen[at]) dot(at, item.kind === 'amulet' ? '#a855f7' : '#facc15', 0.3)
  for (const m of s.monsters) if (s.visible[m.y * W + m.x]) dot(m.y * W + m.x, '#ef4444', 0.4)
  dot(s.player.y * W + s.player.x, '#fde68a', 0.55)
  return { k, ox, oy }
}
