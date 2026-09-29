import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Runner',
  blurb: 'A 3D endless run through a rail yard at dusk. Dodge trains, jump barriers, slide under bars.',
  tags: ['arcade'],
  added: '2026-09-29',
  controls:
    'Swipe left or right to change lanes, up to jump, down to slide (in the air, down drops you fast). Jump the red-and-white barriers, slide under the yellow bars, go around crates and trains. Clip something from the side and you stumble; do it twice in a row and you’re caught. Coins score; magnets pull coins in, shields take one crash, ×2 doubles your score for a while. Keys: arrows or WASD, Space to jump.',
  input: 'touch',
} satisfies GameMeta
