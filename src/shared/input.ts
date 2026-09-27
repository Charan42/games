export type Dir = 'up' | 'down' | 'left' | 'right'

export const DELTA: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
}

// ponytail: one fixed swipe distance in CSS px; make it a parameter if a game feels twitchy or sluggish.
const SWIPE_PX = 24

// Calls onDir for swipes on `area` (touch, mouse or pen) and for arrow keys or WASD anywhere.
// A swipe fires as soon as it travels SWIPE_PX, then keeps measuring from that point: one
// gesture can change direction several times (up, then left), but never repeats a direction,
// so a long swipe is still one move in a turn-based game.
export function onDirection(area: HTMLElement, onDir: (d: Dir) => void) {
  let from: PointerEvent | null = null
  let fired: Dir | null = null
  area.addEventListener('pointerdown', e => {
    from = e
    fired = null
  })
  area.addEventListener('pointermove', e => {
    if (!from || e.pointerId !== from.pointerId) return
    const dx = e.clientX - from.clientX
    const dy = e.clientY - from.clientY
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return
    const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    from = e
    if (d !== fired) onDir((fired = d))
  })
  const end = () => { from = null }
  area.addEventListener('pointerup', end)
  area.addEventListener('pointercancel', end)
  area.addEventListener('contextmenu', e => e.preventDefault()) // long-press menus

  addEventListener('keydown', e => {
    const d = KEYS[e.code]
    if (!d || document.querySelector('dialog[open]')) return
    e.preventDefault() // arrow keys would otherwise scroll
    onDir(d)
  })
}
