// Seeded random numbers (mulberry32). Game logic keeps the seed in its state and passes it
// along, so the same seed and inputs always replay the same game.
export function rand(seed: number): [value: number, next: number] {
  const next = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(next ^ (next >>> 15), next | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

export const newSeed = () => (Math.random() * 2 ** 32) | 0
