import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Reversi',
  blurb: 'Trap and flip discs; corners win games. Versus the computer or a friend.',
  tags: ['strategy', 'board'],
  added: '2026-09-28',
  controls:
    'Tap a square with a dot to place a disc: every line of the other color it traps between your discs flips to yours. If you have no move, you pass. When neither side can move, the most discs wins. Corners can never be flipped. You switch colors each game against the computer. Keys: arrows and Enter.',
  input: 'touch',
} satisfies GameMeta
