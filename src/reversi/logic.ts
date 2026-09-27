// Reversi on an 8 × 8 board. A move must trap a line of the other player's discs between the
// new disc and one of yours; they flip. No move: you pass. Neither can move: most discs wins.
// The computer searches with negamax and alpha-beta pruning.
export const N = 8
export type Player = 1 | 2 // 1 is black and moves first

export interface State {
  board: number[] // N × N, 0 empty
  turn: Player
  over: boolean
  passed: boolean // the player now to move just got the turn back because the other couldn't move
  last: number // the disc just played, -1 at the start
  flipped: number[] // the discs it flipped, for animating
}

export function init(): State {
  const board = Array(N * N).fill(0)
  board[27] = board[36] = 2
  board[28] = board[35] = 1
  return { board, turn: 1, over: false, passed: false, last: -1, flipped: [] }
}

const DIRS = [-9, -8, -7, -1, 1, 7, 8, 9]

// The discs that playing p at cell i would flip; [] means it isn't a legal move.
export function flips(board: number[], i: number, p: number): number[] {
  if (board[i] !== 0) return []
  const out: number[] = []
  for (const d of DIRS) {
    const run: number[] = []
    let j = i + d
    // Stop at the board's edge: a step that wraps to the other side changes column by more than 1.
    while (j >= 0 && j < N * N && Math.abs((j % N) - ((j - d) % N)) <= 1 && board[j] === 3 - p) {
      run.push(j)
      j += d
    }
    if (run.length && j >= 0 && j < N * N && Math.abs((j % N) - ((j - d) % N)) <= 1 && board[j] === p) out.push(...run)
  }
  return out
}

export const moves = (board: number[], p: number) => board.flatMap((_, i) => (flips(board, i, p).length ? [i] : []))

export const count = (board: number[], p: number) => board.filter(v => v === p).length

export function play(s: State, i: number): State {
  const flipped = s.over ? [] : flips(s.board, i, s.turn)
  if (!flipped.length) return s
  const board = s.board.slice()
  for (const j of [i, ...flipped]) board[j] = s.turn
  const other: Player = s.turn === 1 ? 2 : 1
  const otherCan = moves(board, other).length > 0
  const sameCan = !otherCan && moves(board, s.turn).length > 0
  return {
    board,
    turn: otherCan ? other : s.turn,
    over: !otherCan && !sameCan,
    passed: sameCan,
    last: i,
    flipped,
  }
}

// How much each square is worth holding: corners are gold, and the squares that hand the
// other player a corner are poison.
const WEIGHT = [
  100, -25, 10, 5, 5, 10, -25, 100,
  -25, -40, -2, -2, -2, -2, -40, -25,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -25, -40, -2, -2, -2, -2, -40, -25,
  100, -25, 10, 5, 5, 10, -25, 100,
]
const CORNERS = [0, 7, 56, 63]
const WIN = 100_000

function evaluate(board: number[], p: number): number {
  let score = 0
  for (let i = 0; i < N * N; i++) {
    if (!board[i]) continue
    let w = WEIGHT[i]
    // Next to a corner that's already taken, the square is no longer a risk.
    if (w < 0 && CORNERS.some(c => board[c] && Math.abs((c % N) - (i % N)) <= 1 && Math.abs((c >> 3) - (i >> 3)) <= 1)) w = 5
    score += board[i] === p ? w : -w
  }
  // Having more moves than the other side is worth a lot in the middle game.
  return score + 8 * (moves(board, p).length - moves(board, 3 - p).length)
}

function negamax(board: number[], p: number, depth: number, alpha: number, beta: number, passed = false): number {
  const mine = moves(board, p)
  if (!mine.length) {
    if (passed) {
      const diff = count(board, p) - count(board, 3 - p)
      return diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0 // game over
    }
    return -negamax(board, 3 - p, depth, -beta, -alpha, true)
  }
  if (depth === 0) return evaluate(board, p)
  for (const i of order(mine)) {
    const flipped = flips(board, i, p)
    board[i] = p
    for (const j of flipped) board[j] = p
    const score = -negamax(board, 3 - p, depth - 1, -beta, -alpha)
    board[i] = 0
    for (const j of flipped) board[j] = 3 - p
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }
  return alpha
}

// Best squares first, so alpha-beta cuts more.
const order = (list: number[]) => list.sort((a, b) => WEIGHT[b] - WEIGHT[a])

// The square the player to move should take. Near the end (few empty squares) it searches to
// the finish and plays perfectly. `luck` (0–1) picks among moves within `slack` of the best.
export function bestMove(s: State, depth: number, luck = 0, slack = 0, endgame = 0): number {
  const empty = s.board.filter(v => !v).length
  if (empty <= endgame) depth = empty
  const board = s.board.slice()
  const scored = order(moves(board, s.turn)).map(i => {
    const flipped = flips(board, i, s.turn)
    board[i] = s.turn
    for (const j of flipped) board[j] = s.turn
    const score = -negamax(board, 3 - s.turn, depth - 1, -WIN * 2, WIN * 2)
    board[i] = 0
    for (const j of flipped) board[j] = 3 - s.turn
    return [i, score] as const
  })
  const top = Math.max(...scored.map(([, v]) => v))
  const good = scored.filter(([, v]) => v >= top - slack)
  return good[Math.floor(luck * good.length)][0]
}
