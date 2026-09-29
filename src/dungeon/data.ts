// What lives in the dungeon and what lies around in it. Numbers here are the game's balance.

export const FLOORS = 10 // the Amulet waits on the last one

export type MonsterKind =
  | 'rat' | 'bat' | 'kobold' | 'archer' | 'spider' | 'orc' | 'slime' | 'skeleton' | 'wraith' | 'troll' | 'dragon'

export interface MonsterType {
  name: string
  glyph: string
  color: string
  hp: number
  dmg: [number, number]
  armor: number // damage soaked: a random 0 to this, per hit
  hit: number // % chance to hit an unarmored target
  xp: number
  speed: number // 10 is the player's pace; 20 acts twice per turn, 5 every other turn
  depth: [number, number] // floors it's found on
  erratic?: boolean // flutters about at random half the time
  ranged?: number // shoots from up to this far away
  poison?: boolean
  splits?: boolean // hitting it can split it in two
  drain?: boolean // heals itself by what it deals
  regen?: boolean
  breath?: boolean // fire, at range, every few turns
}

export const MONSTERS: Record<MonsterKind, MonsterType> = {
  rat: { name: 'rat', glyph: 'r', color: '#c4a882', hp: 5, dmg: [1, 3], armor: 0, hit: 70, xp: 2, speed: 10, depth: [1, 3] },
  bat: { name: 'bat', glyph: 'b', color: '#a78bfa', hp: 4, dmg: [1, 2], armor: 0, hit: 65, xp: 2, speed: 20, depth: [1, 4], erratic: true },
  kobold: { name: 'kobold', glyph: 'k', color: '#a3e635', hp: 8, dmg: [2, 4], armor: 1, hit: 72, xp: 4, speed: 10, depth: [1, 5] },
  archer: { name: 'goblin archer', glyph: 'g', color: '#facc15', hp: 9, dmg: [2, 4], armor: 1, hit: 70, xp: 7, speed: 10, depth: [2, 7], ranged: 6 },
  spider: { name: 'cave spider', glyph: 's', color: '#f472b6', hp: 11, dmg: [2, 4], armor: 1, hit: 78, xp: 8, speed: 20, depth: [3, 7], poison: true },
  orc: { name: 'orc', glyph: 'o', color: '#4ade80', hp: 18, dmg: [3, 7], armor: 2, hit: 78, xp: 12, speed: 10, depth: [4, 8] },
  slime: { name: 'slime', glyph: 'j', color: '#22d3ee', hp: 24, dmg: [3, 6], armor: 0, hit: 70, xp: 14, speed: 5, depth: [4, 9], splits: true },
  skeleton: { name: 'skeleton', glyph: 'z', color: '#e5e7eb', hp: 24, dmg: [4, 8], armor: 4, hit: 82, xp: 16, speed: 10, depth: [5, 10] },
  wraith: { name: 'wraith', glyph: 'W', color: '#93c5fd', hp: 26, dmg: [4, 8], armor: 3, hit: 84, xp: 22, speed: 10, depth: [6, 10], drain: true },
  troll: { name: 'troll', glyph: 'T', color: '#22c55e', hp: 45, dmg: [6, 11], armor: 5, hit: 84, xp: 32, speed: 10, depth: [7, 10], regen: true },
  dragon: { name: 'dragon', glyph: 'D', color: '#f87171', hp: 140, dmg: [8, 15], armor: 6, hit: 88, xp: 150, speed: 10, depth: [99, 99], breath: true },
}

export const WEAPONS = [
  { name: 'dagger', dmg: [2, 4], depth: 0 },
  { name: 'short sword', dmg: [3, 6], depth: 1 },
  { name: 'mace', dmg: [4, 7], depth: 2 },
  { name: 'long sword', dmg: [5, 9], depth: 4 },
  { name: 'battle axe', dmg: [6, 12], depth: 6 },
  { name: 'war hammer', dmg: [8, 14], depth: 8 },
] as const

export const ARMORS = [
  { name: 'leather armor', armor: 1, depth: 1 },
  { name: 'studded leather', armor: 2, depth: 2 },
  { name: 'chain mail', armor: 3, depth: 4 },
  { name: 'scale mail', armor: 4, depth: 6 },
  { name: 'plate armor', armor: 6, depth: 8 },
] as const

export type PotionType = 'healing' | 'strength' | 'haste' | 'toughness' | 'blindness'
export type ScrollType = 'teleport' | 'mapping' | 'fire' | 'enchant'
export const POTIONS: Record<PotionType, { name: string; weight: number }> = {
  healing: { name: 'healing', weight: 40 },
  strength: { name: 'strength', weight: 10 },
  haste: { name: 'haste', weight: 14 },
  toughness: { name: 'toughness', weight: 12 },
  blindness: { name: 'blindness', weight: 10 },
}
export const SCROLLS: Record<ScrollType, { name: string; weight: number }> = {
  teleport: { name: 'teleportation', weight: 25 },
  mapping: { name: 'magic mapping', weight: 22 },
  fire: { name: 'fire', weight: 25 },
  enchant: { name: 'enchanting', weight: 28 },
}

// Until you try one, a potion is only its color and a scroll only its title. Each game
// shuffles which is which.
export const POTION_LOOKS = [
  { name: 'crimson', color: '#dc2626' },
  { name: 'amber', color: '#f59e0b' },
  { name: 'violet', color: '#8b5cf6' },
  { name: 'emerald', color: '#10b981' },
  { name: 'murky', color: '#78716c' },
  { name: 'azure', color: '#0ea5e9' },
  { name: 'pink', color: '#ec4899' },
]
export const SYLLABLES = ['zel', 'go', 'mer', 'fu', 'bar', 'xi', 'xa', 'nok', 'tu', 'ra', 'vel', 'om', 'ka', 'thu', 'ly', 'ven', 'dro', 'ish']

export type Item =
  | { kind: 'potion'; type: PotionType }
  | { kind: 'scroll'; type: ScrollType }
  | { kind: 'weapon'; index: number; plus: number }
  | { kind: 'armor'; index: number; plus: number }
  | { kind: 'gold'; amount: number }
  | { kind: 'amulet' }

// XP needed for each level; past the table, 100 more each.
export const LEVELS = [0, 10, 25, 45, 70, 100, 140, 190, 250, 320, 400]
export const xpFor = (level: number) => LEVELS[level] ?? 400 + (level - 10) * 100
