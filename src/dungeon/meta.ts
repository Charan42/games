import type { GameMeta } from '../shared/types.ts'

export default {
  title: 'Dungeon',
  blurb: 'A roguelike: ten floors, a new dungeon every game, and a dragon guarding the Amulet at the bottom.',
  tags: ['strategy', 'puzzle'],
  added: '2026-09-29',
  controls:
    'Tap a square to walk there, or next to a monster to attack it; swipe or drag to take single steps (diagonals too). Tap yourself to wait a turn, or to go down when standing on stairs. Explore walks to the nearest unexplored place and picks things up; Rest waits until you’re healed. Both stop when something appears. Potions and scrolls are unknown until you try them. Map shows the floor: tap it to travel. Keys: arrows, WASD or HJKL YUBN to move, . to wait, > to go down, O explore, R rest, I pack, M map.',
  input: 'touch',
} satisfies GameMeta
