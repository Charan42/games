// The Rust engine's exports (crate/src/lib.rs). Only numbers cross the boundary, so this
// interface is all the glue there is.
export interface Engine {
  memory: WebAssembly.Memory
  reset(): void
  fen_buffer(): number
  load(length: number): number
  piece(sq: number): number
  side(): number // 0 white, 1 black
  in_check(): number
  status(): number // index into ENDINGS in logic.ts; 0 while playing
  legal_count(): number
  legal_move(i: number): number
  play(m: number): number
  undo(): number
  think(ms: number, depth: number, noise: number, seed: number): number
  last_depth(): number
  last_score(): number
  last_nodes(): number
}

// The engine's one import: a clock, so it can stop thinking on time.
export async function instantiate(module: WebAssembly.Module) {
  const { exports } = await WebAssembly.instantiate(module, { env: { now: () => performance.now() } })
  return exports as unknown as Engine
}
