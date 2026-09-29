// The TypeScript side of chess: naming moves and counting material. The rules and the search
// live in Rust (crate/src); this only formats what the engine reports.
//
// Squares are 0–63 with a1 = 0 (file + 8 × rank). A move is from | to << 6 | promotion << 12.
// Pieces are a kind (1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king) plus 8 for black.

export const PAWN = 1
export const KNIGHT = 2
export const BISHOP = 3
export const ROOK = 4
export const QUEEN = 5
export const KING = 6
export const BLACK = 8

export const from = (m: number) => m & 63
export const to = (m: number) => (m >> 6) & 63
export const promo = (m: number) => (m >> 12) & 7
export const encode = (f: number, t: number, p = 0) => f | (t << 6) | (p << 12)
export const kind = (p: number) => p & 7
export const isBlack = (p: number) => (p & BLACK) !== 0

export const squareName = (sq: number) => 'abcdefgh'[sq & 7] + ((sq >> 3) + 1)
const LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K']

// Why the game ended, by the engine's status code.
export const ENDINGS = ['', 'Checkmate', 'Stalemate', 'Draw by the fifty-move rule', 'Draw by repetition', 'Draw: not enough material']

// Standard algebraic notation (Nf3, exd5, O-O, e8=Q+) for a legal move in a position.
// `suffix` is '+' or '#' when the move gives check or mate.
export function san(board: ArrayLike<number>, legal: readonly number[], m: number, suffix = ''): string {
  const [f, t] = [from(m), to(m)]
  const piece = kind(board[f])
  if (piece === KING && Math.abs((t & 7) - (f & 7)) === 2) return ((t & 7) === 6 ? 'O-O' : 'O-O-O') + suffix
  const capture = board[t] !== 0 || (piece === PAWN && (f & 7) !== (t & 7))
  if (piece === PAWN) {
    return (capture ? `${'abcdefgh'[f & 7]}x` : '') + squareName(t) + (promo(m) ? `=${LETTER[promo(m)]}` : '') + suffix
  }
  // Name the file, the rank or both, only if another piece like this one could also go there.
  const rivals = legal.filter(o => to(o) === t && from(o) !== f && kind(board[from(o)]) === piece).map(from)
  let which = ''
  if (rivals.length) {
    if (rivals.every(r => (r & 7) !== (f & 7))) which = 'abcdefgh'[f & 7]
    else if (rivals.every(r => r >> 3 !== f >> 3)) which = String((f >> 3) + 1)
    else which = squareName(f)
  }
  return LETTER[piece] + which + (capture ? 'x' : '') + squareName(t) + suffix
}

const START_COUNT = [0, 8, 2, 2, 2, 1, 0]
const VALUE = [0, 1, 3, 3, 5, 9, 0]

// The pieces each side has lost (kinds, most valuable first) and White's material lead in pawns.
// A promoted pawn counts as whatever it became, so a side can be "missing" a negative number
// of queens; those are simply not shown.
export function material(board: ArrayLike<number>) {
  const left = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]]
  for (let sq = 0; sq < 64; sq++) if (board[sq]) left[isBlack(board[sq]) ? 1 : 0][kind(board[sq])]++
  const lost = left.map(counts =>
    [QUEEN, ROOK, BISHOP, KNIGHT, PAWN].flatMap(k => Array<number>(Math.max(0, START_COUNT[k] - counts[k])).fill(k)),
  )
  const worth = (counts: number[]) => counts.reduce((sum, n, k) => sum + n * VALUE[k], 0)
  return { lost: { white: lost[0], black: lost[1] }, lead: worth(left[0]) - worth(left[1]) }
}

// The computer's strength: how long and how deep it may think, and how much random noise (in
// centipawns) blurs its judgment of each candidate move. Tested against each other in
// crate/src/search.rs: each level beats the one below every game.
export type Level = 'easy' | 'medium' | 'hard'
export const LEVELS: Record<Level, { ms: number; depth: number; noise: number }> = {
  easy: { ms: 300, depth: 1, noise: 220 },
  medium: { ms: 500, depth: 3, noise: 50 },
  hard: { ms: 1500, depth: 64, noise: 0 },
}
