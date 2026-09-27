import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Dots and Boxes',
  blurb: 'Close boxes, go again, and never hand over a chain. Versus the computer or a friend.',
  tags: ['strategy', 'board'],
  added: '2026-09-28',
  controls:
    'Tap between two dots to draw a line. Drawing the fourth side of a box takes it and gives you another turn. Most boxes wins. Careful: a third side hands your opponent the box, and often a whole chain. With a mouse, click near a line.',
  input: 'touch',
} satisfies GameMeta
