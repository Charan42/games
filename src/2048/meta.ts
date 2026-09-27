import type { GameMeta } from '../shared/types.ts'

export default {
  title: '2048',
  blurb: 'Slide the tiles, merge equal numbers, reach 2048.',
  tags: ['puzzle'],
  added: '2026-09-28',
  controls:
    'Swipe to slide every tile that way. Two tiles with the same number merge into their sum. Each move adds a new tile; the game ends when no move is left. On a keyboard, use the arrow keys or WASD.',
  input: 'touch',
} satisfies GameMeta
