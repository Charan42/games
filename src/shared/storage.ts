// Saved values for the current game, stored as games:<slug>:<key>. Every Pages site under
// the same github.io account shares one origin (and one localStorage), hence the prefix.
const slug = location.pathname.replace(/index\.html$/, '').split('/').filter(Boolean).at(-1)

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem(`games:${slug}:${key}`)
      return value === null ? fallback : (JSON.parse(value) as T)
    } catch {
      return fallback // storage blocked (private mode, disabled site data): play on without saving
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`games:${slug}:${key}`, JSON.stringify(value))
    } catch {
      // same as above: losing a best score beats crashing the game
    }
  },
}
