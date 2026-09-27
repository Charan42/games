import type { GameMeta } from '../shared/types.ts'

// New game: cp -r src/_template src/<slug>, then update this file and the <title> and
// description in index.html. It stays off the hub until you delete the `wip` line.
export default {
  title: 'Template',
  blurb: 'Step onto the dot. Copy this folder to start a new game.',
  tags: ['puzzle'],
  added: '2026-09-27',
  controls: 'Swipe to move one square. On a keyboard, use the arrow keys or WASD.',
  input: 'touch',
  wip: true,
} satisfies GameMeta
