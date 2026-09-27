// Dots and Boxes on a grid of COLS × ROWS boxes. Players take turns drawing a line between two
// neighboring dots; whoever draws a box's fourth side takes the box and must draw again.
export const COLS = 5
export const ROWS = 6
export type Player = 1 | 2

// Lines are numbered: first the horizontal ones, row by row (ROWS + 1 rows of COLS), then the
// vertical ones (ROWS rows of COLS + 1).
const H = (ROWS + 1) * COLS
export const LINES = H + ROWS * (COLS + 1)
export const horizontal = (e: number) => e < H
// The dot a line starts from (its left or top end), as [col, row].
export const start = (e: number): [number, number] =>
  e < H ? [e % COLS, Math.floor(e / COLS)] : [(e - H) % (COLS + 1), Math.floor((e - H) / (COLS + 1))]
export const lineAt = (col: number, row: number, across: boolean) => (across ? row * COLS + col : H + row * (COLS + 1) + col)

// Each box's four sides, and the one or two boxes each line borders.
export const SIDES = Array.from({ length: COLS * ROWS }, (_, b) => {
  const [c, r] = [b % COLS, Math.floor(b / COLS)]
  return [lineAt(c, r, true), lineAt(c, r + 1, true), lineAt(c, r, false), lineAt(c + 1, r, false)]
})
const BORDERS: number[][] = Array.from({ length: LINES }, () => [])
SIDES.forEach((sides, b) => sides.forEach(e => BORDERS[e].push(b)))

export interface State {
  lines: number[] // 0 undrawn, else who drew it
  boxes: number[] // 0 open, else who took it
  turn: Player
  score: [number, number, number] // [unused, player 1, player 2]
  last: number
}

export const init = (first: Player = 1): State => ({
  lines: Array(LINES).fill(0),
  boxes: Array(COLS * ROWS).fill(0),
  turn: first,
  score: [0, 0, 0],
  last: -1,
})

export const over = (s: State) => s.lines.every(Boolean)

const drawnSides = (lines: number[], b: number) => SIDES[b].reduce((n, e) => n + (lines[e] ? 1 : 0), 0)

export function draw(s: State, e: number): State {
  if (s.lines[e] || e < 0 || e >= LINES) return s
  const lines = s.lines.slice()
  lines[e] = s.turn
  const boxes = s.boxes.slice()
  const score: State['score'] = [...s.score]
  for (const b of BORDERS[e])
    if (drawnSides(lines, b) === 4) {
      boxes[b] = s.turn
      score[s.turn]++
    }
  const took = score[s.turn] > s.score[s.turn]
  return { lines, boxes, turn: took ? s.turn : s.turn === 1 ? 2 : 1, score, last: e }
}

// The lines that finish a box right now.
const captures = (lines: number[]) => lines.flatMap((v, e) => (!v && BORDERS[e].some(b => drawnSides(lines, b) === 3) ? [e] : []))

// How many boxes the other player gets if we draw e: they take everything it opens up.
function giveaway(lines: number[], e: number): number {
  const l = lines.slice()
  l[e] = 1
  let taken = 0
  for (let c = captures(l); c.length; c = captures(l)) {
    const before = BORDERS[c[0]].filter(b => drawnSides(l, b) === 4).length
    l[c[0]] = 1
    taken += BORDERS[c[0]].filter(b => drawnSides(l, b) === 4).length - before
  }
  return taken
}

// The computer's line. Both levels take free boxes. Hard never hands over a box while it has a
// safe line left, and when it must, gives away the smallest chain; easy only sometimes looks.
// `luck` (0–1) picks among equally good lines.
// ponytail: no double-dealing (leaving the last two boxes of a chain to keep control), the
// expert endgame trick; add it if hard gets beaten too often.
export function bestLine(s: State, hard: boolean, luck: number): number {
  const pick = (list: number[]) => list[Math.floor(luck * list.length)]
  const take = captures(s.lines)
  if (take.length) return take[0]
  const open = s.lines.flatMap((v, e) => (v ? [] : [e]))
  const safe = open.filter(e => BORDERS[e].every(b => drawnSides(s.lines, b) < 2))
  if (safe.length && (hard || luck < 0.6)) return pick(safe)
  if (!hard) return pick(open)
  const cost = open.map(e => giveaway(s.lines, e))
  const least = Math.min(...cost)
  return pick(open.filter((_, k) => cost[k] === least))
}
