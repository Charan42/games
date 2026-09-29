import { mountBar } from '../shared/bar.ts'
import { newSeed } from '../shared/rng.ts'
import { store } from '../shared/storage.ts'
import { ARMORS, FLOORS, WEAPONS, xpFor } from './data.ts'
import { addEvents, animating, drawItem, drawMap, drawWorld, noEffects, type Camera } from './draw.ts'
import { H, NEIGHBORS, STAIRS, W, distances, passable } from './gen.ts'
import {
  PACK_SIZE, armorValue, damageRange, dailySeed, here, itemName, newGame, score, stairsSeen, step, travelStep,
  visibleMonsters, type Action, type State, type Tone,
} from './logic.ts'
import meta from './meta.ts'

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const canvas = $<HTMLCanvasElement>('canvas')
const ctx = canvas.getContext('2d')!
const board = canvas.parentElement!
const logEl = $('.log')
const pack = $<HTMLDialogElement>('#pack')
const menu = $<HTMLDialogElement>('#newgame')
const end = $<HTMLDialogElement>('#end')

type Auto = { kind: 'travel' | 'explore' | 'rest'; target: number; hp: number; seen: Set<number> }

let s: State
let fx = noEffects()
let cam: Camera = { x: 0, y: 0 }
let T = 32 // tile size in CSS pixels
let view = { w: 0, h: 0 }
let mapOpen = false
let mapBox = { k: 1, ox: 0, oy: 0 }
let auto: Auto | null = null
let lastAuto = 0
let dirty = true
const skipped = new Set<number>() // item squares Explore gave up on (pack full)

mountBar(meta, () => stopAuto())

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function start(daily: boolean) {
  const date = daily ? today() : ''
  s = newGame(daily ? dailySeed(date) : newSeed(), date)
  note('Tap a square to walk there. Tap next to a monster to fight it.')
  fx = noEffects()
  fx.fade = performance.now()
  cam = { x: s.player.x + 0.5, y: s.player.y + 0.5 }
  skipped.clear()
  auto = null
  mapOpen = false
  save()
  ui()
}

const save = () => store.set('run', s.over ? null : { ...s, events: [] })

// A line in the log from the page rather than the rules (a hint, or why nothing happened).
function note(text: string, tone: Tone = 'info') {
  s = { ...s, log: [...s.log, { text, tone }] }
  ui()
}

function act(a: Action) {
  if (s.over) return false
  const before = s
  s = step(s, a)
  if (s.clock === before.clock && s.depth === before.depth && s.log.length === before.log.length) return false
  addEvents(fx, s, s.events, performance.now())
  if (s.depth !== before.depth) {
    skipped.clear()
    cam = { x: s.player.x + 0.5, y: s.player.y + 0.5 }
  }
  if (s.player.hp < before.player.hp) navigator.vibrate?.(25)
  dirty = true
  save()
  ui()
  if (s.over) setTimeout(finish, 700)
  return true
}

function move(dx: number, dy: number) {
  if (!act({ type: 'move', dx, dy })) navigator.vibrate?.(10)
}

// --- Walking on its own: travel to a square, explore, rest -------------------------------------

function stopAuto() {
  auto = null
  ui()
}

function begin(kind: Auto['kind'], target = -1) {
  if (s.over) return
  if (visibleMonsters(s).length) return note(kind === 'rest' ? 'You can’t rest with monsters in sight.' : 'Not with monsters in sight.')
  if (kind === 'rest' && s.player.hp >= s.player.maxHp && !s.player.poison && !s.player.blind) return note('You’re already rested.')
  auto = { kind, target, hp: s.player.hp, seen: new Set(visibleMonsters(s).map(m => m.id)) }
  lastAuto = 0
  ui()
}

// The nearest square worth walking to: an item not picked up yet, or the edge of the unknown.
function exploreTarget() {
  const known = (i: number) => s.seen[i] === 1 && passable(s.tiles[i])
  const dist = distances(s.tiles, here(s), known)
  const wanted = new Set(s.items.filter(it => s.seen[it.at] && !skipped.has(it.at)).map(it => it.at))
  let best = -1
  for (let i = 0; i < W * H; i++) {
    if (dist[i] <= 0 || (best >= 0 && dist[i] >= dist[best])) continue
    const [x, y] = [i % W, Math.floor(i / W)]
    const edge = NEIGHBORS.some(([dx, dy]) => x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && !s.seen[(y + dy) * W + x + dx])
    if (edge || wanted.has(i)) best = i
  }
  return best
}

function runAuto() {
  if (!auto) return
  const a = auto
  const interrupted = () => {
    if (s.over) return 'over'
    if (visibleMonsters(s).some(m => !a.seen.has(m.id))) return 'monster'
    if (s.player.hp < a.hp) return 'hurt'
    return ''
  }
  if (a.kind === 'rest') {
    for (let k = 0; k < 8; k++) {
      const p = s.player
      if (p.hp >= p.maxHp && !p.poison && !p.blind) return stopAuto()
      act({ type: 'wait' })
      a.hp = Math.min(a.hp, s.player.hp) // poison ticks don't stop a rest
      if (interrupted()) return stopAuto()
    }
    return
  }
  if (a.kind === 'explore') {
    a.target = exploreTarget()
    if (a.target < 0) {
      const stairs = stairsSeen(s)
      if (stairs >= 0 && stairs !== here(s)) {
        note('This floor is explored. Heading for the stairs.')
        a.kind = 'travel'
        a.target = stairs
      } else {
        note(stairs >= 0 ? 'Explored. Tap Stairs to go down.' : 'Nothing left to explore.')
        return stopAuto()
      }
    }
  }
  const dir = travelStep(s, a.target)
  if (!dir) return stopAuto()
  const pack = s.player.pack.length
  act({ type: 'move', ...dir })
  // Standing on something the pack had no room for: don't keep coming back for it.
  if (s.items.some(it => it.at === here(s)) && s.player.pack.length === pack) skipped.add(here(s))
  if (interrupted() || (a.kind === 'travel' && here(s) === a.target)) stopAuto()
}

// --- Input -----------------------------------------------------------------------------------

function tileAt(clientX: number, clientY: number): [number, number] | null {
  const r = canvas.getBoundingClientRect()
  if (mapOpen) {
    const x = Math.floor((clientX - r.left - mapBox.ox) / mapBox.k)
    const y = Math.floor((clientY - r.top - mapBox.oy) / mapBox.k)
    return x >= 0 && y >= 0 && x < W && y < H ? [x, y] : null
  }
  const x = Math.floor(cam.x + (clientX - r.left - r.width / 2) / T)
  const y = Math.floor(cam.y + (clientY - r.top - r.height / 2) / T)
  return x >= 0 && y >= 0 && x < W && y < H ? [x, y] : null
}

function tap(x: number, y: number) {
  if (auto) return stopAuto()
  if (s.over) return finish()
  const p = s.player
  const [dx, dy] = [x - p.x, y - p.y]
  const i = y * W + x
  if (mapOpen) {
    toggleMap(false)
    if (s.seen[i] && passable(s.tiles[i]) && i !== here(s)) begin('travel', i)
    return
  }
  if (!dx && !dy) return act(s.tiles[i] === STAIRS ? { type: 'descend' } : { type: 'wait' })
  if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) return move(dx, dy)
  if (s.seen[i] && passable(s.tiles[i])) {
    // Walk there, unless monsters are about: then just take a step that way.
    if (!visibleMonsters(s).length) return begin('travel', i)
  }
  move(Math.sign(dx), Math.sign(dy))
}

// A tap walks; a swipe steps, and dragging on keeps stepping (one step per SWIPE_PX).
const SWIPE_PX = 30
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
let touch: { id: number; x: number; y: number; swiped: boolean } | null = null
canvas.addEventListener('pointerdown', e => {
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, swiped: false }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', e => {
  if (!touch || e.pointerId !== touch.id || mapOpen) return
  const [dx, dy] = [e.clientX - touch.x, e.clientY - touch.y]
  if (Math.hypot(dx, dy) < SWIPE_PX) return
  if (auto) stopAuto()
  const [mx, my] = DIRS[Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7]
  ;[touch.x, touch.y, touch.swiped] = [e.clientX, e.clientY, true]
  move(mx, my)
})
canvas.addEventListener('pointerup', e => {
  if (!touch || e.pointerId !== touch.id) return
  const t = touch
  touch = null
  if (t.swiped) return
  const at = tileAt(e.clientX, e.clientY)
  if (at) tap(...at)
  else if (mapOpen) toggleMap(false)
})
canvas.addEventListener('pointercancel', () => (touch = null))
canvas.addEventListener('contextmenu', e => e.preventDefault())

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  KeyK: [0, -1], KeyJ: [0, 1], KeyH: [-1, 0], KeyL: [1, 0], KeyY: [-1, -1], KeyU: [1, -1], KeyB: [-1, 1], KeyN: [1, 1],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0], Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
}
addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return
  if (auto) {
    stopAuto()
    return e.preventDefault()
  }
  const dir = KEYS[e.code]
  if (e.key === '>') stairs()
  else if (dir) {
    if (mapOpen) toggleMap(false)
    move(...dir)
  } else if (e.code === 'Period' || e.code === 'Numpad5' || e.code === 'Space') act({ type: 'wait' })
  else if (e.code === 'KeyO' || e.code === 'KeyX') begin('explore')
  else if (e.code === 'KeyR') begin('rest')
  else if (e.code === 'KeyI') openPack()
  else if (e.code === 'KeyM') toggleMap()
  else if (e.code === 'Escape') toggleMap(false)
  else return
  e.preventDefault()
})

function stairs() {
  if (auto) stopAuto()
  if (s.tiles[here(s)] === STAIRS) return act({ type: 'descend' })
  const at = stairsSeen(s)
  if (at < 0) return note('You haven’t found the stairs down yet.')
  begin('travel', at)
}

function toggleMap(open = !mapOpen) {
  mapOpen = open
  $('#map').setAttribute('aria-pressed', String(open))
  dirty = true
}

$('#explore').onclick = () => (auto?.kind === 'explore' ? stopAuto() : begin('explore'))
$('#rest').onclick = () => (auto?.kind === 'rest' ? stopAuto() : begin('rest'))
$('#stairs').onclick = stairs
$('#bag').onclick = openPack
$('#map').onclick = () => toggleMap()
$('#menu').onclick = () => {
  stopAuto()
  showScores(menu)
  menu.returnValue = ''
  menu.showModal()
}
for (const d of [menu, end]) {
  d.addEventListener('close', () => {
    if (d.returnValue === 'new' || d.returnValue === 'daily') start(d.returnValue === 'daily')
  })
}
document.addEventListener('visibilitychange', () => document.hidden && stopAuto())

// --- The pack ---------------------------------------------------------------------------------

const VERB = { potion: 'Drink', scroll: 'Read', weapon: 'Wield', armor: 'Wear' } as Record<string, string>

function openPack() {
  stopAuto()
  const p = s.player
  const [lo, hi] = damageRange(p)
  const armor = p.armor ? `wearing ${itemName(s, p.armor)} (armor ${armorValue(p)})` : 'no armor'
  pack.querySelector('.gear')!.textContent = `Wielding ${itemName(s, p.weapon)} (${lo}–${hi} damage), ${armor}. ${p.pack.length}/${PACK_SIZE} slots used.`
  const list = pack.querySelector('.items')!
  list.replaceChildren()
  if (!p.pack.length) list.innerHTML = '<li class="empty">Nothing yet.</li>'
  p.pack.forEach((stack, index) => {
    const li = document.createElement('li')
    const icon = document.createElement('canvas')
    icon.width = icon.height = 64
    const ic = icon.getContext('2d')!
    ic.scale(2, 2)
    drawItem(ic, s, stack.item, 0, 0, 32, 0)
    const name = document.createElement('span')
    name.textContent = itemName(s, stack.item, stack.count) + gearNote(stack.item)
    const use = button(VERB[stack.item.kind], () => act({ type: 'use', index }))
    const drop = button('Drop', () => act({ type: 'drop', index }))
    li.append(icon, name, use, drop)
    list.append(li)
  })
  pack.showModal()
}

// For gear in the pack: how it compares with what you have on.
function gearNote(item: State['player']['pack'][number]['item']) {
  const p = s.player
  if (item.kind === 'weapon') {
    const w = WEAPONS[item.index]
    const now = WEAPONS[p.weapon.index]
    const gain = (w.dmg[0] + w.dmg[1]) / 2 + item.plus - ((now.dmg[0] + now.dmg[1]) / 2 + p.weapon.plus)
    return ` (${w.dmg[0] + item.plus}–${w.dmg[1] + item.plus}${gain > 0 ? ', better' : ''})`
  }
  if (item.kind === 'armor') {
    const value = ARMORS[item.index].armor + item.plus
    return ` (armor ${value}${value > armorValue(p) ? ', better' : ''})`
  }
  return ''
}

function button(label: string, onClick: () => void) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'chip'
  b.textContent = label
  b.onclick = () => {
    pack.close()
    onClick()
  }
  return b
}

// --- The end ---------------------------------------------------------------------------------

function finish() {
  if (!s.over || end.open) return
  const final = score(s)
  const best = Math.max(final, store.get('best', 0))
  store.set('best', best)
  if (s.daily) {
    const daily = store.get<{ date: string; best: number }>('daily', { date: '', best: 0 })
    store.set('daily', { date: s.daily, best: daily.date === s.daily ? Math.max(daily.best, final) : final })
  }
  end.querySelector('h2')!.textContent = s.over.won ? 'You escaped with the Amulet!' : 'You died'
  end.querySelector('.cause')!.textContent =
    `${s.over.cause}. Level ${s.player.level}, ${s.kills} kill${s.kills === 1 ? '' : 's'}, ${s.gold} gold${s.daily ? `, in the dungeon of ${s.daily}` : ''}.`
  showScores(end, final)
  end.returnValue = ''
  end.showModal()
}

function showScores(d: HTMLDialogElement, final?: number) {
  const daily = store.get<{ date: string; best: number }>('daily', { date: '', best: 0 })
  const parts = [final !== undefined ? `Score ${final}` : '', `Best ${store.get('best', 0)}`, daily.date === today() ? `Today’s best ${daily.best}` : '']
  d.querySelector('.scores')!.textContent = parts.filter(Boolean).join(' · ')
}

// --- Numbers and messages ------------------------------------------------------------------------

let shownLog = ''
function ui() {
  const p = s.player
  const hp = $('.hp')
  hp.querySelector('i')!.style.width = `${(100 * Math.max(0, p.hp)) / p.maxHp}%`
  hp.classList.toggle('ok', p.hp > p.maxHp * 0.35)
  $('#hp').textContent = `${Math.max(0, p.hp)} / ${p.maxHp}`
  $('#level').textContent = String(p.level)
  const floor = xpFor(p.level - 1) // what this level took; 0 at level 1
  $('.xp i').style.width = `${Math.min(100, (100 * (p.xp - floor)) / (xpFor(p.level) - floor))}%`
  $('#depth').textContent = `${s.depth}/${FLOORS}`
  $('#gold').textContent = String(s.gold)
  $('#status').innerHTML = [p.haste && '<i class="haste">Fast</i>', p.poison && '<i class="poison">Poison</i>', p.blind && '<i class="blind">Blind</i>']
    .filter(Boolean)
    .join('')
  const log = JSON.stringify(s.log.slice(-3)) + s.log.length
  if (log !== shownLog) {
    shownLog = log
    const recent = s.log.slice(-3)
    logEl.replaceChildren(
      ...recent.map((m, k) => {
        const li = document.createElement('li')
        li.textContent = m.text
        li.className = `${m.tone} ${k === recent.length - 1 ? 'new' : ''}`
        return li
      }),
    )
  }
  const onStairs = s.tiles[here(s)] === STAIRS
  $('#stairs').textContent = onStairs ? '▼ Down' : 'Stairs'
  $('#explore').setAttribute('aria-pressed', String(auto?.kind === 'explore'))
  $('#rest').setAttribute('aria-pressed', String(auto?.kind === 'rest'))
}

// --- Drawing -----------------------------------------------------------------------------------

new ResizeObserver(() => {
  const [w, h] = [board.clientWidth, board.clientHeight]
  T = Math.max(24, Math.min(48, Math.floor(Math.min(w / 11, h / 13))))
  const dpr = Math.min(devicePixelRatio, 2)
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  view = { w, h }
  dirty = true
}).observe(board)

// The camera follows you, but stops at the map's edges when the map is bigger than the screen.
function cameraGoal(): [number, number] {
  const axis = (v: number, half: number, size: number) => (size <= half * 2 ? size / 2 : Math.min(size - half, Math.max(half, v)))
  return [axis(s.player.x + 0.5, view.w / 2 / T, W), axis(s.player.y + 0.5, view.h / 2 / T, H)]
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (auto && now - lastAuto > (auto.kind === 'rest' ? 30 : 70)) {
    lastAuto = now
    runAuto()
  }
  const [gx, gy] = cameraGoal()
  const moving = Math.abs(gx - cam.x) > 0.01 || Math.abs(gy - cam.y) > 0.01
  if (moving) {
    const k = 1 - Math.exp(-dt * 12)
    cam.x += (gx - cam.x) * k
    cam.y += (gy - cam.y) * k
  }
  const asleep = s.monsters.some(m => !m.awake && s.visible[m.y * W + m.x])
  const amulet = s.items.some(it => it.item.kind === 'amulet' && s.seen[it.at])
  if (dirty || moving || animating(fx, now) || asleep || amulet) {
    dirty = false
    drawWorld(ctx, view.w, view.h, T, cam, s, fx, now)
    if (mapOpen) mapBox = drawMap(ctx, view.w, view.h, s)
  }
  requestAnimationFrame(frame)
}

// Pick up the run where it was left, or start one.
const saved = store.get<State | null>('run', null)
if (saved && !saved.over && Array.isArray(saved.tiles) && saved.tiles.length === W * H) {
  s = saved
  cam = { x: s.player.x + 0.5, y: s.player.y + 0.5 }
  ui()
} else start(false)
requestAnimationFrame(frame)
