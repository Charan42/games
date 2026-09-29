// Drawing Starfighter on a canvas the size of the field (360 × 640 units, scaled to fit).
// Glowing things are drawn from pre-rendered sprites with additive blending, which is much
// cheaper than canvas shadows when there are a hundred bullets on screen. Nothing here affects
// play, so it uses Math.random freely.
import { ENEMIES, H, W, type Enemy, type Event, type Item, type State } from './logic.ts'

const BULLET_COLORS = ['#ff4f8b', '#ffb13b', '#9b7bff'] // by bullet.color

function sprite(size: number, paint: (c: CanvasRenderingContext2D, r: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size * 2
  const c = canvas.getContext('2d')!
  c.scale(2, 2) // crisp on 2x screens
  paint(c, size / 2)
  return canvas
}
const glow = (color: string, core = '#ffffff') =>
  sprite(32, (c, r) => {
    const g = c.createRadialGradient(r, r, 0, r, r, r)
    g.addColorStop(0, core)
    g.addColorStop(0.25, core)
    g.addColorStop(0.4, color)
    g.addColorStop(1, 'rgb(0 0 0 / 0)')
    c.fillStyle = g
    c.fillRect(0, 0, r * 2, r * 2)
  })
const BULLETS = BULLET_COLORS.map(c => glow(c))
const SHOT = sprite(32, (c, r) => {
  const g = c.createLinearGradient(r, 0, r, r * 2)
  g.addColorStop(0, 'rgb(180 250 255 / 0)')
  g.addColorStop(0.4, '#a5f3fc')
  g.addColorStop(1, 'rgb(34 211 238 / 0)')
  c.fillStyle = g
  c.fillRect(r - 3, 0, 6, r * 2)
  c.fillStyle = '#ffffff'
  c.fillRect(r - 1, r * 0.5, 2, r)
})
const SPARK = glow('#ffd28a', '#fff7e6')
const BLUE = glow('#60a5fa', '#e0f2fe')

// The sky: a nebula that drifts by slowly and three layers of stars at different speeds.
const NEBULA = (() => {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H * 2
  const c = canvas.getContext('2d')!
  const blob = (x: number, y: number, r: number, color: string) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgb(0 0 0 / 0)')
    c.fillStyle = g
    c.fillRect(x - r, y - r, r * 2, r * 2)
  }
  for (const y of [0, H]) {
    blob(80, y + 160, 220, 'rgb(124 58 237 / 0.28)')
    blob(300, y + 420, 260, 'rgb(236 72 153 / 0.18)')
    blob(200, y + 620, 200, 'rgb(14 165 233 / 0.16)')
  }
  return canvas
})()
const STARS = Array.from({ length: 140 }, (_, i) => ({
  x: Math.random() * W,
  y: Math.random() * H,
  layer: i % 3,
  tint: Math.random() < 0.15 ? '#fde68a' : Math.random() < 0.2 ? '#bfdbfe' : '#ffffff',
}))

// --- Effects ---------------------------------------------------------------------------------

interface Particle { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number; img: HTMLCanvasElement }
interface Ring { x: number; y: number; r: number; grow: number; life: number; age: number; color: string }
export interface Effects { particles: Particle[]; rings: Ring[]; shake: number; flash: number; banner: { text: string; age: number } | null }
export const effects = (): Effects => ({ particles: [], rings: [], shake: 0, flash: 0, banner: null })

export function addEvents(fx: Effects, events: Event[], s: State) {
  for (const e of events) {
    if (e.type === 'explode') {
      const n = Math.min(40, 10 + e.size)
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const v = Math.random() * (1 + e.size / 12)
        fx.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 25 + Math.random() * 25, age: 0, size: 6 + Math.random() * e.size * 0.4, img: SPARK })
      }
      fx.rings.push({ x: e.x, y: e.y, r: e.size * 0.5, grow: 1.5 + e.size / 20, life: 22, age: 0, color: '#ffd28a' })
      if (e.size >= 30) fx.shake = Math.max(fx.shake, e.size >= 46 ? 26 : 14)
    } else if (e.type === 'hit') {
      fx.particles.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2, life: 8, age: 0, size: 8, img: BLUE })
    } else if (e.type === 'graze') {
      fx.particles.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, life: 10, age: 0, size: 5, img: SPARK })
    } else if (e.type === 'bomb') {
      fx.rings.push({ x: s.player.x, y: s.player.y, r: 10, grow: 9, life: 60, age: 0, color: '#93c5fd' })
      fx.flash = 12
      fx.shake = 12
    } else if (e.type === 'death') {
      fx.shake = 20
      fx.flash = 8
    } else if (e.type === 'boss') {
      fx.banner = { text: 'WARNING', age: 0 }
    } else if (e.type === 'clear') {
      fx.banner = { text: `STAGE ${s.stage} CLEAR`, age: 0 }
    } else if (e.type === 'extend') {
      fx.banner = { text: 'EXTRA SHIP', age: 0 }
    }
  }
}

// --- Drawing ---------------------------------------------------------------------------------

// `a` is how far between the last two ticks to draw (0–1); `k` is this frame's length in
// 60ths of a second, so effects age at the same speed on any screen.
export function draw(c: CanvasRenderingContext2D, s: State, prev: State, a: number, fx: Effects, time: number, k: number) {
  c.save()
  if (fx.shake > 0) {
    c.translate((Math.random() - 0.5) * fx.shake * 0.4, (Math.random() - 0.5) * fx.shake * 0.4)
    fx.shake *= 0.9 ** k
    if (fx.shake < 0.5) fx.shake = 0
  }
  const g = c.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#05060f')
  g.addColorStop(1, '#120a28')
  c.fillStyle = g
  c.fillRect(-20, -20, W + 40, H + 40)
  const scroll = (time * 0.012) % H
  c.drawImage(NEBULA, 0, scroll - H)
  for (const st of STARS) {
    const speed = [0.02, 0.05, 0.11][st.layer]
    const y = (st.y + time * speed) % H
    c.globalAlpha = [0.35, 0.6, 0.95][st.layer]
    c.fillStyle = st.tint
    const size = [1, 1.4, 2][st.layer]
    c.fillRect(st.x, y, size, st.layer === 2 ? size * 2.5 : size)
  }
  c.globalAlpha = 1

  for (const it of s.items) drawItem(c, it, time)
  for (const e of s.enemies) drawEnemy(c, e, time)

  // Your ship, blinking while it can't be hit, and its hitbox.
  const p = s.player
  const px = prev.player.respawn || p.respawn ? p.x : prev.player.x + (p.x - prev.player.x) * a
  const py = prev.player.respawn || p.respawn ? p.y : prev.player.y + (p.y - prev.player.y) * a
  if (!p.respawn && !(p.invuln > 0 && Math.floor(time / 70) % 2)) drawShip(c, px, py, time)
  if (s.bombing) {
    c.globalAlpha = 0.25 + 0.15 * Math.sin(time / 40)
    c.strokeStyle = '#93c5fd'
    c.lineWidth = 3
    c.beginPath()
    c.arc(px, py, 26, 0, Math.PI * 2)
    c.stroke()
    c.globalAlpha = 1
  }

  c.globalCompositeOperation = 'lighter'
  for (const b of s.shots) c.drawImage(SHOT, b.x + b.vx * a - 8, b.y + b.vy * a - 16, 16, 32)
  for (const b of s.bullets) {
    const r = b.r * 2.6
    c.drawImage(BULLETS[b.color], b.x + b.vx * a - r, b.y + b.vy * a - r, r * 2, r * 2)
  }
  fx.particles = fx.particles.filter(pt => (pt.age += k) < pt.life)
  for (const pt of fx.particles) {
    pt.x += pt.vx * k
    pt.y += pt.vy * k
    pt.vx *= 0.95 ** k
    pt.vy *= 0.95 ** k
    const left = 1 - pt.age / pt.life
    c.globalAlpha = left
    const size = pt.size * (0.5 + left * 0.5)
    c.drawImage(pt.img, pt.x - size, pt.y - size, size * 2, size * 2)
  }
  fx.rings = fx.rings.filter(r => (r.age += k) < r.life)
  for (const r of fx.rings) {
    r.r += r.grow * k
    c.globalAlpha = 1 - r.age / r.life
    c.strokeStyle = r.color
    c.lineWidth = 3
    c.beginPath()
    c.arc(r.x, r.y, r.r, 0, Math.PI * 2)
    c.stroke()
  }
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'

  // Bullets keep a solid white core so they stay readable over the glow.
  c.fillStyle = '#ffffff'
  for (const b of s.bullets) {
    c.beginPath()
    c.arc(b.x + b.vx * a, b.y + b.vy * a, b.r * 0.55, 0, Math.PI * 2)
    c.fill()
  }
  if (!p.respawn) {
    c.fillStyle = '#ffffff'
    c.strokeStyle = '#ff4f8b'
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(px, py, 3, 0, Math.PI * 2)
    c.fill()
    c.stroke()
  }

  const boss = s.enemies.find(e => e.kind === 'boss')
  if (boss) {
    c.fillStyle = 'rgb(0 0 0 / 0.5)'
    c.fillRect(20, 12, W - 40, 7)
    c.fillStyle = boss.hp / boss.maxHp > 0.33 ? '#f472b6' : '#ef4444'
    c.fillRect(20, 12, ((W - 40) * boss.hp) / boss.maxHp, 7)
    c.strokeStyle = 'rgb(255 255 255 / 0.5)'
    c.lineWidth = 1
    for (const k of [1 / 3, 2 / 3]) {
      c.beginPath()
      c.moveTo(20 + (W - 40) * k, 11)
      c.lineTo(20 + (W - 40) * k, 20)
      c.stroke()
    }
  }

  if (fx.banner) {
    const b = fx.banner
    b.age += k
    const fade = b.age < 20 ? b.age / 20 : b.age > 130 ? (160 - b.age) / 30 : 1
    if (b.age > 160) fx.banner = null
    c.globalAlpha = Math.max(0, fade)
    c.fillStyle = b.text === 'WARNING' ? '#f87171' : '#fde68a'
    c.font = '900 30px system-ui, sans-serif'
    c.textAlign = 'center'
    c.fillText(b.text, W / 2, H * 0.4)
    if (b.text === 'WARNING') {
      c.font = '600 14px system-ui, sans-serif'
      c.fillText('A huge ship is approaching', W / 2, H * 0.4 + 26)
    }
    c.globalAlpha = 1
  }
  if (fx.flash > 0) {
    c.fillStyle = `rgb(255 255 255 / ${fx.flash / 30})`
    c.fillRect(-20, -20, W + 40, H + 40)
    fx.flash -= k
  }
  c.restore()
}

function drawShip(c: CanvasRenderingContext2D, x: number, y: number, time: number) {
  c.save()
  c.translate(x, y)
  // Engine flame.
  c.globalCompositeOperation = 'lighter'
  const flame = 10 + Math.sin(time / 30) * 3 + Math.random() * 3
  c.drawImage(BLUE, -8, 8, 16, flame * 1.6)
  c.globalCompositeOperation = 'source-over'
  // Wings, hull, cockpit.
  c.fillStyle = '#334155'
  c.beginPath()
  c.moveTo(0, -6)
  c.lineTo(17, 10)
  c.lineTo(15, 14)
  c.lineTo(0, 9)
  c.lineTo(-15, 14)
  c.lineTo(-17, 10)
  c.closePath()
  c.fill()
  const hull = c.createLinearGradient(-6, 0, 6, 0)
  hull.addColorStop(0, '#cbd5e1')
  hull.addColorStop(0.5, '#f8fafc')
  hull.addColorStop(1, '#94a3b8')
  c.fillStyle = hull
  c.beginPath()
  c.moveTo(0, -18)
  c.lineTo(6, 2)
  c.lineTo(5, 12)
  c.lineTo(-5, 12)
  c.lineTo(-6, 2)
  c.closePath()
  c.fill()
  c.fillStyle = '#22d3ee'
  c.beginPath()
  c.ellipse(0, -4, 2.6, 5, 0, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = '#f43f5e'
  c.fillRect(-16, 9, 3, 3)
  c.fillRect(13, 9, 3, 3)
  c.restore()
}

function drawEnemy(c: CanvasRenderingContext2D, e: Enemy, time: number) {
  const r = ENEMIES[e.kind].r
  // Small ships blink white when hit; big ones, hit all the time, only get a glaze of it.
  const big = e.kind === 'bomber' || e.kind === 'boss'
  if (big) {
    shape(c, e, r, time, false)
    if (e.flash > 0) shape(c, e, r, time, true)
  } else shape(c, e, r, time, e.flash > 0)
  // A health bar under anything that takes a few hits.
  if (e.kind !== 'boss' && e.kind !== 'drone' && e.hp < e.maxHp) {
    c.fillStyle = 'rgb(0 0 0 / 0.5)'
    c.fillRect(e.x - r, e.y + r + 4, r * 2, 3)
    c.fillStyle = '#4ade80'
    c.fillRect(e.x - r, e.y + r + 4, (r * 2 * e.hp) / e.maxHp, 3)
  }
}

// An enemy's shape in its colors, or all in `white` (solid for small ships, a glaze for big).
function shape(c: CanvasRenderingContext2D, e: Enemy, r: number, time: number, white: boolean) {
  c.save()
  c.translate(e.x, e.y)
  const tint = e.kind === 'bomber' || e.kind === 'boss' ? 'rgb(255 255 255 / 0.22)' : '#ffffff'
  const fill = (color: string) => (c.fillStyle = white ? tint : color)
  if (e.kind === 'drone') {
    fill('#f97316')
    c.beginPath()
    c.moveTo(0, r)
    c.lineTo(r * 0.9, -r * 0.6)
    c.lineTo(0, -r * 0.2)
    c.lineTo(-r * 0.9, -r * 0.6)
    c.closePath()
    c.fill()
    fill('#fde047')
    c.beginPath()
    c.arc(0, 0, 3, 0, Math.PI * 2)
    c.fill()
  } else if (e.kind === 'swooper') {
    c.rotate(e.dir * 0.3)
    fill('#a855f7')
    c.beginPath()
    c.moveTo(0, r)
    c.quadraticCurveTo(r * 1.4, -r * 0.2, r * 1.1, -r)
    c.quadraticCurveTo(0, -r * 0.3, -r * 1.1, -r)
    c.quadraticCurveTo(-r * 1.4, -r * 0.2, 0, r)
    c.fill()
    fill('#f0abfc')
    c.beginPath()
    c.arc(0, -r * 0.1, 4, 0, Math.PI * 2)
    c.fill()
  } else if (e.kind === 'turret') {
    fill('#0f766e')
    c.beginPath()
    for (let i = 0; i < 6; i++) c.lineTo(Math.cos((i / 6) * Math.PI * 2) * r, Math.sin((i / 6) * Math.PI * 2) * r)
    c.closePath()
    c.fill()
    c.rotate(time / 400)
    fill('#5eead4')
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2)
      c.fillRect(-2.5, r * 0.3, 5, r * 0.75)
    }
    fill('#ccfbf1')
    c.beginPath()
    c.arc(0, 0, r * 0.35, 0, Math.PI * 2)
    c.fill()
  } else if (e.kind === 'bomber') {
    fill('#475569')
    c.beginPath()
    c.moveTo(0, r)
    c.lineTo(r * 1.3, -r * 0.2)
    c.lineTo(r * 1.1, -r * 0.7)
    c.lineTo(0, -r * 0.4)
    c.lineTo(-r * 1.1, -r * 0.7)
    c.lineTo(-r * 1.3, -r * 0.2)
    c.closePath()
    c.fill()
    fill('#64748b')
    c.fillRect(-r * 0.3, -r, r * 0.6, r * 1.6)
    fill(Math.floor(time / 250) % 2 ? '#ef4444' : '#7f1d1d')
    for (const x of [-r, r]) c.fillRect(x - 3, -r * 0.35, 6, 6)
  } else {
    drawBoss(c, e, time, white)
  }
  c.restore()
}

function drawBoss(c: CanvasRenderingContext2D, e: Enemy, time: number, white: boolean) {
  const life = e.hp / e.maxHp
  const core = life > 0.66 ? '#f472b6' : life > 0.33 ? '#fb923c' : '#ef4444'
  const fill = (color: string) => (c.fillStyle = white ? 'rgb(255 255 255 / 0.22)' : color)
  // Wings and cannons.
  fill('#3f3f62')
  c.beginPath()
  c.moveTo(-120, -10)
  c.lineTo(-40, -40)
  c.lineTo(40, -40)
  c.lineTo(120, -10)
  c.lineTo(90, 20)
  c.lineTo(40, 10)
  c.lineTo(0, 44)
  c.lineTo(-40, 10)
  c.lineTo(-90, 20)
  c.closePath()
  c.fill()
  fill('#5b5b8a')
  for (const x of [-34, 34]) c.fillRect(x - 6, 0, 12, 26)
  fill('#2a2a44')
  c.fillRect(-100, -6, 200, 6)
  // The core, pulsing in the color of its phase.
  const pulse = 14 + Math.sin(time / 120) * 3
  if (!white) {
    c.globalCompositeOperation = 'lighter'
    c.drawImage(life > 0.33 ? BULLETS[0] : BULLETS[1], -pulse * 2.2, -pulse * 2.2 - 6, pulse * 4.4, pulse * 4.4)
    c.globalCompositeOperation = 'source-over'
  }
  fill(core)
  c.beginPath()
  c.arc(0, -6, 12, 0, Math.PI * 2)
  c.fill()
  fill('#ffffff')
  c.beginPath()
  c.arc(-3, -9, 3, 0, Math.PI * 2)
  c.fill()
}

function drawItem(c: CanvasRenderingContext2D, it: Item, time: number) {
  c.save()
  c.translate(it.x, it.y)
  if (it.kind === 'medal') {
    c.rotate(time / 300)
    c.fillStyle = '#facc15'
    c.beginPath()
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? 3.5 : 8
      c.lineTo(Math.cos((i / 10) * Math.PI * 2) * rr, Math.sin((i / 10) * Math.PI * 2) * rr)
    }
    c.closePath()
    c.fill()
  } else {
    const color = it.kind === 'power' ? '#ef4444' : it.kind === 'bomb' ? '#22c55e' : '#ec4899'
    const label = it.kind === 'power' ? 'P' : it.kind === 'bomb' ? 'B' : '1UP'
    c.scale(1 + Math.sin(time / 150) * 0.08, 1 + Math.sin(time / 150) * 0.08)
    c.fillStyle = color
    c.beginPath()
    c.roundRect(-12, -9, 24, 18, 6)
    c.fill()
    c.fillStyle = '#ffffff'
    c.font = `900 ${label.length > 1 ? 9 : 13}px system-ui, sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(label, 0, 1)
  }
  c.restore()
}
