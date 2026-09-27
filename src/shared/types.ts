export type Tag = 'arcade' | 'puzzle' | 'board' | 'word' | 'sim' | 'multiplayer'

export interface GameMeta {
  title: string
  blurb: string // one line on the card
  tags: Tag[]
  added: string // 'YYYY-MM-DD': sorts newest first
  controls: string // how to play, shown in the help dialog
  input: 'touch' | 'controller' // 'controller' = needs a keyboard or gamepad; own hub section
  landscape?: boolean // touch games are portrait unless this is set
  wip?: boolean // unlisted: built and reachable by URL, hidden from the hub in production
}
