import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Mines',
  blurb: 'Open every safe square; the numbers tell you where the mines are.',
  tags: ['puzzle'],
  added: '2026-09-28',
  controls:
    'Tap a square to open it; a number says how many of the eight squares around it hide mines. Long-press (or right-click) to flag a mine, or switch on Flag mode so taps flag. Tap an opened number once all its mines are flagged to open the rest around it. Your first tap is always safe. Keys: arrows, Enter to open, F to flag.',
  input: 'touch',
} satisfies GameMeta
