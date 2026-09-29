import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Chess',
  blurb: 'Full chess against an engine written in Rust, thinking in WebAssembly. Three levels, or a friend.',
  tags: ['board', 'strategy'],
  added: '2026-09-29',
  controls:
    'Tap a piece to see where it can go, then tap a square; or drag it there. Pawns reaching the last row ask what to become. Undo takes back your last move. New game picks the opponent (easy, medium, hard, or a friend on the same phone) and your color. With a keyboard: arrow keys and Enter, U to undo, F to flip the board.',
  input: 'touch',
} satisfies GameMeta
