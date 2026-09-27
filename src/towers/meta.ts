import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Tower Defense',
  blurb: 'Build and upgrade towers along the road. How many waves can you hold?',
  tags: ['strategy'],
  added: '2026-09-28',
  controls:
    'Pick a tower at the bottom, then tap a square beside the road to build it. Tap a tower to see its range, upgrade it or sell it. Gun: fast, single target. Cannon: splash damage for groups. Frost: slows. Sniper: huge range, ignores armor. Enemies grow tougher and better armored, so mix towers and upgrade. "Next wave" calls a wave early for bonus gold; ×2 speeds things up.',
  input: 'touch',
} satisfies GameMeta
