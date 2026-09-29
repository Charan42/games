import { ACESFilmicToneMapping, Color, Matrix4, Object3D, PCFShadowMap, PerspectiveCamera, Quaternion, Vector3, WebGLRenderer } from 'three'
import { mountBar } from '../shared/bar.ts'
import { onDirection } from '../shared/input.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { LANE_W, SLIDE_TICKS, START_SPEED, TICKS, init, input, step, type Event, type Input, type State } from './logic.ts'
import meta from './meta.ts'
import {
  SLEEPER, disposeObstacle, makeCity, makeCoins, makeDebris, makeObstacle, makePoles, makePower, makeRunner, makeScene,
  makeSunDisc, makeTrack,
} from './scene.ts'

const TICK_MS = 1000 / TICKS
const MAX_COINS = 240
const CRASH_MS = 900 // the fall plays out before the score shows

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!
const canvas = document.querySelector('canvas')!
const board = canvas.parentElement!
const overlay = document.querySelector<HTMLButtonElement>('.overlay')!

let renderer: WebGLRenderer
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
} catch {
  board.innerHTML = '<p class="overlay">This game needs WebGL, which this browser doesn’t have.</p>'
  throw new Error('no WebGL')
}
let pixelRatio = Math.min(devicePixelRatio, 1.75)
renderer.setPixelRatio(pixelRatio)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFShadowMap
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const { scene, sun } = makeScene()
const camera = new PerspectiveCamera(60, 1, 0.1, 400)
const track = makeTrack()
const city = makeCity()
const poles = makePoles()
const sunDisc = makeSunDisc()
const runner = makeRunner()
const coinMesh = makeCoins(MAX_COINS)
const debrisMesh = makeDebris(80)
scene.add(track.track, city.group, poles.group, sunDisc, runner.root, coinMesh, debrisMesh)

let s: State = init(newSeed())
let prev = s
let mode: 'ready' | 'playing' | 'paused' | 'crashing' | 'over' = 'ready'
let best = store.get('best', 0)
let lag = 0
let last = performance.now()
let crashedAt = 0
let shakeUntil = 0
let camX = 0

const obstacleMeshes = new Map<number, Object3D>()
const powerMeshes = new Map<number, Object3D>()
const flying: { from: Vector3; born: number }[] = []
const debris: { p: Vector3; v: Vector3; born: number; color: Color }[] = []

mountBar(meta, pause)

function restart() {
  for (const m of obstacleMeshes.values()) scene.remove(m), disposeObstacle(m)
  for (const m of powerMeshes.values()) scene.remove(m)
  obstacleMeshes.clear()
  powerMeshes.clear()
  flying.length = debris.length = 0
  s = prev = init(newSeed())
  runner.root.rotation.set(0, 0, 0)
  mode = 'playing'
  overlay.hidden = true
  lag = 0
}

function start() {
  if (mode === 'ready' || mode === 'over') restart()
  else if (mode === 'paused') {
    mode = 'playing'
    overlay.hidden = true
  }
}

function pause() {
  if (mode !== 'playing') return
  mode = 'paused'
  show('Paused', 'Tap to carry on')
}

function show(title: string, ...lines: string[]) {
  overlay.innerHTML = '<strong></strong>'
  overlay.querySelector('strong')!.textContent = title
  for (const line of lines) {
    const span = document.createElement('span')
    span.textContent = line
    overlay.append(span)
  }
  overlay.hidden = false
}

function act(what: Input) {
  if (mode === 'ready' || mode === 'paused') start()
  if (mode !== 'playing') return
  s = input(s, what)
  events(s.events)
}

onDirection($('main'), d => act(({ up: 'jump', down: 'slide', left: 'left', right: 'right' } as const)[d]))
addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return
  if (e.code === 'Space') {
    e.preventDefault()
    if (mode === 'over') start()
    else act('jump')
  }
})
overlay.onclick = start
document.addEventListener('visibilitychange', () => document.hidden && pause())
addEventListener('blur', pause)

// --- What happened in a tick ---------------------------------------------------------------

function events(list: Event[]) {
  const now = performance.now()
  for (const e of list) {
    if (e.type === 'coin') {
      const c = prev.pickups.find(p => p.id === e.id) ?? s.pickups.find(p => p.id === e.id)
      if (c) flying.push({ from: new Vector3(c.lane * LANE_W, c.y, -c.z), born: now })
    } else if (e.type === 'power') {
      navigator.vibrate?.(30)
    } else if (e.type === 'stumble') {
      shakeUntil = now + 250
      navigator.vibrate?.(50)
    } else if (e.type === 'shield') {
      shakeUntil = now + 300
      burst(new Vector3(s.x, 1.2, -s.d - 1), '#7dd3fc', 30)
      navigator.vibrate?.(60)
    } else if (e.type === 'crash') {
      shakeUntil = now + 450
      burst(new Vector3(s.x, 1, -s.d - 0.5), '#fbbf24', 26)
      navigator.vibrate?.([80, 40, 120])
    }
  }
}

function burst(at: Vector3, color: string, n: number) {
  const c = new Color(color)
  for (let i = 0; i < n; i++) {
    const v = new Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.3).normalize().multiplyScalar(4 + Math.random() * 6)
    debris.push({ p: at.clone(), v, born: performance.now(), color: c })
  }
}

// --- The loop ------------------------------------------------------------------------------

// If frames come slower than ~45 a second while running, render fewer pixels.
let slow = 0
function adapt(dt: number) {
  slow = dt > 0.022 ? slow + dt : Math.max(0, slow - dt)
  if (slow > 2 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25)
    renderer.setPixelRatio(pixelRatio)
    slow = 0
  }
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (mode === 'playing' && !document.hidden) adapt(dt)
  if (mode === 'playing') {
    lag = Math.min(lag + dt * 1000, 250)
    while (lag >= TICK_MS && mode === 'playing') {
      lag -= TICK_MS
      prev = s
      s = step(s)
      events(s.events)
      if (s.over) {
        mode = 'crashing'
        crashedAt = now
      }
    }
  }
  if (mode === 'crashing' && now - crashedAt > CRASH_MS) gameOver()
  render(now, dt, mode === 'playing' ? lag / TICK_MS : 1)
  requestAnimationFrame(frame)
}

function gameOver() {
  mode = 'over'
  const score = Math.floor(s.score)
  const record = score > best
  if (record) store.set('best', (best = score))
  show(record ? 'New best!' : 'Caught!', `Score ${score} · ${s.coins} coins · ${Math.floor(s.d)} m`, `Best ${best}`, 'Tap to run again')
}

const m4 = new Matrix4()
const q = new Quaternion()
const up = new Vector3(0, 1, 0)
const v3 = new Vector3()
const one = new Vector3(1, 1, 1)

function render(now: number, dt: number, a: number) {
  const lerp = (p: number, c: number) => p + (c - p) * a
  const d = lerp(prev.d, s.d)
  const x = lerp(prev.x, s.x)
  const y = lerp(prev.y, s.y)
  const t = now / 1000

  // The runner: running, jumping, sliding, leaning into turns; falling after a crash.
  runner.root.position.set(x, y, -d)
  const air = y > 0.05
  runner.pose(mode === 'ready' ? 0 : d * 1.25, air, s.sliding > 0 && !air ? 1 - s.sliding / SLIDE_TICKS : -1, (x - s.lane * LANE_W) * 0.12)
  runner.bubble.visible = s.shield > 0
  if (mode === 'crashing' || mode === 'over') {
    const k = Math.min(1, (now - crashedAt) / 400)
    runner.root.rotation.x = -k * 1.3
    runner.root.position.y = y * (1 - k)
  }

  // Camera behind and above, easing sideways; a wider view the faster you go.
  camX += (x * 0.55 - camX) * Math.min(1, dt * 8)
  const shake = now < shakeUntil ? (shakeUntil - now) / 1500 : 0
  camera.position.set(camX + (Math.random() - 0.5) * shake, 3.6 + y * 0.25 + (Math.random() - 0.5) * shake, -d + 7.4)
  camera.lookAt(camX * 0.9, 1.3, -d - 12)
  const fov = 60 + (s.speed - START_SPEED) * 0.4
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }

  // Scenery that moves with you.
  track.moving.position.z = -d
  track.ground.position.z = -d - 80
  track.sleepers.position.z = -Math.floor(d / SLEEPER) * SLEEPER
  city.place(d)
  poles.place(d)
  sunDisc.position.set(camX * 0.3, 26, -d - 178)
  sun.position.set(x - 7, 17, -d - 9)
  sun.target.position.set(x, 0, -d - 3)

  // Obstacles and power-ups: make meshes for new ones, drop the ones behind or smashed.
  const live = new Set<number>()
  for (const o of s.obstacles) {
    if (o.broken || o.z > d + 170) continue
    live.add(o.id)
    let mesh = obstacleMeshes.get(o.id)
    if (!mesh) {
      mesh = makeObstacle(o)
      obstacleMeshes.set(o.id, mesh)
      scene.add(mesh)
    }
    mesh.position.z = -o.z
  }
  for (const [id, mesh] of obstacleMeshes) {
    if (live.has(id)) continue
    scene.remove(mesh)
    disposeObstacle(mesh)
    obstacleMeshes.delete(id)
  }
  live.clear()
  for (const p of s.powers) {
    live.add(p.id)
    let mesh = powerMeshes.get(p.id)
    if (!mesh) {
      mesh = makePower(p.kind)
      powerMeshes.set(p.id, mesh)
      scene.add(mesh)
    }
    mesh.position.set(p.lane * LANE_W, 1.1 + Math.sin(t * 3 + p.id) * 0.15, -p.z)
    mesh.rotation.y = t * 2
  }
  for (const [id, mesh] of powerMeshes) {
    if (!live.has(id)) scene.remove(mesh), powerMeshes.delete(id)
  }

  // Coins spin in place; collected ones fly into you.
  let n = 0
  for (const c of s.pickups) {
    if (c.z > d + 160 || n >= MAX_COINS) continue
    q.setFromAxisAngle(up, t * 3 + c.id)
    coinMesh.setMatrixAt(n++, m4.compose(v3.set(c.lane * LANE_W, c.y, -c.z), q, one))
  }
  const target = new Vector3(x, y + 1.1, -d)
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i]
    const k = (now - f.born) / 220
    if (k >= 1 || n >= MAX_COINS) {
      flying.splice(i, 1)
      continue
    }
    q.setFromAxisAngle(up, t * 12)
    const size = 1 - k * 0.7
    coinMesh.setMatrixAt(n++, m4.compose(v3.copy(f.from).lerp(target, k), q, new Vector3(size, size, size)))
  }
  coinMesh.count = n
  coinMesh.instanceMatrix.needsUpdate = true

  let k = 0
  for (let i = debris.length - 1; i >= 0; i--) {
    const p = debris[i]
    const age = (now - p.born) / 1000
    if (age > 0.9) {
      debris.splice(i, 1)
      continue
    }
    p.v.y -= 20 * dt
    p.p.addScaledVector(p.v, dt)
    const size = 1 - age
    q.setFromAxisAngle(up, age * 8)
    debrisMesh.setMatrixAt(k, m4.compose(p.p, q, new Vector3(size, size, size)))
    debrisMesh.setColorAt(k, p.color)
    k++
  }
  debrisMesh.count = k
  debrisMesh.instanceMatrix.needsUpdate = true
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true

  renderer.render(scene, camera)
  hud()
}

let shown = ''
function hud() {
  const powers = (['magnet', 'shield', 'double'] as const).filter(k => s[k] > 0)
  const key = `${Math.floor(s.score)}|${s.coins}|${best}|${powers.map(k => `${k}${Math.ceil(s[k] / 30)}`).join()}`
  if (key === shown) return
  shown = key
  $('#score').textContent = String(Math.floor(s.score))
  $('#best').textContent = best ? `Best ${best}` : ''
  $('#coins').textContent = String(s.coins)
  const full = { magnet: 600, shield: 900, double: 600 }
  $('.powers').innerHTML = powers
    .map(k => `<li class="${k}">${k === 'double' ? '×2 score' : k[0].toUpperCase() + k.slice(1)}<i style="width: ${(100 * s[k]) / full[k]}%"></i></li>`)
    .join('')
}

new ResizeObserver(() => {
  const [w, h] = [board.clientWidth, board.clientHeight]
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}).observe(board)

hud()
requestAnimationFrame(frame)
