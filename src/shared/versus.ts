import { store } from './storage.ts'

// Who takes the other side in a two-player board game: the computer, at two strengths, or a
// friend on the same phone. A button cycles through them; the choice is remembered per game.
export type Opponent = 'easy' | 'hard' | 'friend'

const LABEL: Record<Opponent, string> = { easy: 'vs CPU · easy', hard: 'vs CPU · hard', friend: '2 players' }
const NEXT: Record<Opponent, Opponent> = { easy: 'hard', hard: 'friend', friend: 'easy' }

export function opponentPicker(button: HTMLButtonElement, onChange: (o: Opponent) => void) {
  let current = store.get<Opponent>('opponent', 'easy')
  if (!(current in LABEL)) current = 'easy'
  button.textContent = LABEL[current]
  button.onclick = () => {
    current = NEXT[current]
    store.set('opponent', current)
    button.textContent = LABEL[current]
    onChange(current)
  }
  return () => current
}
