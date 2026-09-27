import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Connect Four',
  blurb: 'Drop discs, line up four. Beat the computer or a friend.',
  tags: ['strategy', 'board'],
  added: '2026-09-28',
  controls:
    'Tap a column to drop a disc there; four in a row, across, down or diagonally, wins. Play the computer (easy or hard) or pass the phone to a friend; starts alternate each game. Keys: 1–7 drop in that column, or arrows then Enter.',
  input: 'touch',
} satisfies GameMeta
