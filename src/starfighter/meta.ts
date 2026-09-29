import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Starfighter',
  blurb: 'A bullet-hell shooter: weave through storms of fire, graze bullets for points, and take down a boss every stage.',
  tags: ['arcade'],
  added: '2026-09-29',
  controls:
    'Drag anywhere: your ship moves with your finger, so your thumb never hides it. You fire all the time. Only the small dot in the middle of your ship can be hit; bullets that pass close graze it for points. Catch medals in a row for a bigger chain, P for more firepower, B for bombs. A bomb (the button, or tap with a second finger) clears every bullet on screen into medals. Keys: arrows or WASD to fly, Shift to go slow, X or Space to bomb, P to pause.',
  input: 'touch',
} satisfies GameMeta
