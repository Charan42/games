// Connect Four: drop discs into a 7 × 6 grid; four in a row wins. The computer player is a
// negamax search with alpha-beta pruning.
export const COLS = 7
export const ROWS = 6
export type Player = 1 | 2

export interface State {
  board: number[] // ROWS × COLS, row 0 at the top; 0 is empty, else the player's disc
  turn: Player
  winner: Player | 0
  line: number[] // the winning discs, for highlighting
  full: boolean // board full with no winner: a draw
  last: number // index of the last disc dropped, -1 at the start
}

export const init = (first: Player = 1): State => ({
  board: Array(ROWS * COLS).fill(0),
  turn: first,
  winner: 0,
  line: [],
  full: false,
  last: -1,
})

export const over = (s: State) => s.winner !== 0 || s.full

export const canDrop = (s: State, col: number) => !over(s) && col >= 0 && col < COLS && s.board[col] === 0

// The row a disc dropped in `col` lands in, or -1 if the column is full.
export function landing(board: number[], col: number) {
  for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + col] === 0) return r
  return -1
}

export function drop(s: State, col: number): State {
  if (!canDrop(s, col)) return s
  const board = s.board.slice()
  const i = landing(board, col) * COLS + col
  board[i] = s.turn
  const line = lineThrough(board, i)
  return {
    board,
    turn: s.turn === 1 ? 2 : 1,
    winner: line.length ? s.turn : 0,
    line,
    full: !line.length && board.every(v => v !== 0),
    last: i,
  }
}

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

// Discs in a row of four or more through cell i, all the same player's; [] if there's none.
function lineThrough(board: number[], i: number): number[] {
  const cells: number[] = []
  for (const [dc, dr] of DIRS) {
    const run = [i]
    for (const sign of [1, -1]) {
      let c = (i % COLS) + dc * sign
      let r = Math.floor(i / COLS) + dr * sign
      while (c >= 0 && c < COLS && r >= 0 && r < ROWS && board[r * COLS + c] === board[i]) {
        run.push(r * COLS + c)
        c += dc * sign
        r += dr * sign
      }
    }
    if (run.length >= 4) cells.push(...run)
  }
  return cells
}

// Every window of four cells in a line, for scoring positions.
const WINDOWS: number[][] = []
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    for (const [dc, dr] of DIRS) {
      const w = [0, 1, 2, 3].map(k => [c + dc * k, r + dr * k])
      if (w.every(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS)) WINDOWS.push(w.map(([x, y]) => y * COLS + x))
    }

const WIN = 1_000_000
const WORTH = [0, 1, 6, 40] // a window holding 1, 2 or 3 discs of one player and none of the other's
const ORDER = [3, 2, 4, 1, 5, 0, 6] // center first: trying good moves first prunes more

// How good the board looks for p: open windows, plus a little for holding the center column.
function evaluate(board: number[], p: number): number {
  let score = 0
  for (const w of WINDOWS) {
    let mine = 0
    let theirs = 0
    for (const i of w) {
      if (board[i] === p) mine++
      else if (board[i] !== 0) theirs++
    }
    if (!theirs) score += WORTH[mine]
    else if (!mine) score -= WORTH[theirs]
  }
  for (let r = 0; r < ROWS; r++) {
    const v = board[r * COLS + 3]
    if (v) score += v === p ? 3 : -3
  }
  return score
}

// Best score p can force from here, looking `depth` moves ahead. Mutates the board, then undoes.
function negamax(board: number[], p: number, depth: number, alpha: number, beta: number): number {
  if (depth === 0) return evaluate(board, p)
  let moved = false
  for (const col of ORDER) {
    const r = landing(board, col)
    if (r < 0) continue
    moved = true
    const i = r * COLS + col
    board[i] = p
    // A win found sooner scores higher, so the search takes it (and delays losing).
    const score = lineThrough(board, i).length ? WIN + depth : -negamax(board, 3 - p, depth - 1, -beta, -alpha)
    board[i] = 0
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }
  return moved ? alpha : 0 // no moves left: a draw
}

// The column the player to move should drop in. `luck` (0–1) picks among the moves within
// `slack` points of the best, so a weaker computer doesn't play the same game every time.
export function bestMove(s: State, depth: number, luck = 0, slack = 0): number {
  const board = s.board.slice()
  const scored: [number, number][] = []
  for (const col of ORDER) {
    const r = landing(board, col)
    if (r < 0) continue
    const i = r * COLS + col
    board[i] = s.turn
    scored.push([col, lineThrough(board, i).length ? WIN + depth : -negamax(board, 3 - s.turn, depth - 1, -WIN * 2, WIN * 2)])
    board[i] = 0
  }
  const top = Math.max(...scored.map(([, v]) => v))
  const good = scored.filter(([, v]) => v >= top - slack)
  return good[Math.floor(luck * good.length)][0]
}
