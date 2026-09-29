import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BISHOP, KNIGHT, PAWN, QUEEN, ROOK, encode, material, san } from './logic.ts'

// A board array (a1 = 0) from the piece-placement part of a FEN.
function board(placement: string) {
  const b = Array<number>(64).fill(0)
  placement.split('/').forEach((row, i) => {
    let file = 0
    for (const c of row) {
      if (/\d/.test(c)) file += Number(c)
      else b[(7 - i) * 8 + file++] = ' pnbrqk'.indexOf(c.toLowerCase()) + (c === c.toLowerCase() ? 8 : 0)
    }
  })
  return b
}
const sq = (name: string) => name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8
const m = (uci: string, p = 0) => encode(sq(uci.slice(0, 2)), sq(uci.slice(2, 4)), p)

test('pawn moves, captures and promotions', () => {
  const b = board('4k3/1P6/8/3p4/4P3/8/8/4K3')
  assert.equal(san(b, [], m('e4e5')), 'e5')
  assert.equal(san(b, [], m('e4d5')), 'exd5')
  assert.equal(san(b, [], m('b7b8', QUEEN), '+'), 'b8=Q+')
  // En passant: the target square is empty, but the pawn changed files.
  assert.equal(san(board('4k3/8/8/3pP3/8/8/8/4K3'), [], m('e5d6')), 'exd6')
})

test('castling', () => {
  const b = board('r3k2r/8/8/8/8/8/8/R3K2R')
  assert.equal(san(b, [], m('e1g1')), 'O-O')
  assert.equal(san(b, [], m('e1c1'), '+'), 'O-O-O+')
  assert.equal(san(b, [], m('e1f1')), 'Kf1')
})

test('pieces are told apart by file, then rank, then both', () => {
  // Knights on b1 and f1 can both reach d2: name the file.
  const knights = board('4k3/8/8/8/8/8/8/1N2KN2')
  const both = [m('b1d2'), m('f1d2')]
  assert.equal(san(knights, both, m('b1d2')), 'Nbd2')
  assert.equal(san(knights, [m('b1d2')], m('b1d2')), 'Nd2')
  // Rooks on a1 and a5, same file: name the rank.
  const rooks = board('4k3/8/8/R7/8/8/8/R3K3')
  assert.equal(san(rooks, [m('a1a3'), m('a5a3')], m('a5a3')), 'R5a3')
  // Three queens around e4: one shares a file with a rival and a rank with another.
  const queens = board('4k3/8/8/8/Q6Q/8/8/4K2Q')
  assert.equal(san(queens, [m('h4e4'), m('a4e4'), m('h1e4')], m('h4e4')), 'Qh4e4')
  assert.equal(san(board('4k3/8/8/8/8/8/3p4/4K3'), [], m('e1d2')), 'Kxd2')
})

test('material: what each side lost, and who is ahead', () => {
  const start = material(board('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'))
  assert.deepEqual(start, { lost: { white: [], black: [] }, lead: 0 })
  const after = material(board('r1bqkb1r/pppp1ppp/8/8/8/8/PPPPPPP1/RNB1KBNR'))
  assert.deepEqual(after.lost.white, [QUEEN, PAWN])
  assert.deepEqual(after.lost.black, [KNIGHT, KNIGHT, PAWN])
  assert.equal(after.lead, -10 + 7)
  // A promoted queen isn't a lost pawn plus a negative queen.
  const promoted = material(board('4k3/8/8/8/8/8/8/QQ2K3'))
  assert.deepEqual(promoted.lost.white, [ROOK, ROOK, BISHOP, BISHOP, KNIGHT, KNIGHT, ...Array(8).fill(PAWN)])
})
