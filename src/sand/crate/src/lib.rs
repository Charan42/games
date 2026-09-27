//! Falling-sand simulation for src/sand, compiled to WebAssembly.
//!
//! The grid lives in WASM memory. Each frame JS calls `step`, then uploads the `view` buffer
//! (four bytes per cell: element, shade, heat, aux) to the GPU, where ../../render.ts shades
//! it. Only numbers cross the boundary, so there's no wasm-bindgen: the exports at the bottom
//! are plain `extern "C"` functions.
//!
//! Physics, in short: grains and liquids fall with gravity and keep their momentum, so pours
//! speed up, liquids splash and grains scatter. Every cell has a temperature that conducts to
//! its neighbors (and rises through air), and heat drives the chemistry: water boils and
//! freezes, lava crusts into stone, sand melts into glass, and fuel catches fire when it gets
//! hot enough rather than by touching a flame.

use std::cell::RefCell;

// Element ids. The toolbar in ../../main.ts and the shader in ../../render.ts use the same numbers.
pub const EMPTY: u8 = 0;
pub const WALL: u8 = 1;
pub const SAND: u8 = 2;
pub const WATER: u8 = 3;
pub const WOOD: u8 = 4;
pub const FIRE: u8 = 5;
pub const PLANT: u8 = 6;
pub const LAVA: u8 = 7;
pub const OIL: u8 = 8;
pub const SMOKE: u8 = 9;
pub const STEAM: u8 = 10;
pub const EMBER: u8 = 11; // something burning: stays put, stays hot, throws flames
pub const STONE: u8 = 12; // cooled lava
pub const GLASS: u8 = 13; // melted sand
pub const ICE: u8 = 14;

const AMBIENT: f32 = 20.0; // °C; the air drifts back to this
const GRAVITY: i8 = 2; // speeds are in 1/16 cells per frame
const MAX_SPEED: i8 = 112; // 7 cells a frame

#[derive(Clone, Copy, PartialEq, Debug)]
struct Cell {
    kind: u8,
    shade: u8, // per-grain color variation, fixed when the cell is created
    life: u8,  // countdown for fire, embers and smoke
    clock: u8, // frame stamp, so a cell that already moved this frame isn't moved again
    vx: i8,
    vy: i8,
    temp: f32, // °C
}

const AIR: Cell = Cell { kind: EMPTY, shade: 0, life: 0, clock: 0, vx: 0, vy: 0, temp: AMBIENT };

// A moving element swaps places with anything lighter in its way.
fn weight(kind: u8) -> u8 {
    match kind {
        EMPTY => 0,
        SMOKE | STEAM | FIRE => 1,
        OIL => 2,
        WATER => 3,
        LAVA => 4,
        SAND => 5,
        STONE => 6,
        _ => u8::MAX, // walls, wood, plants, embers, glass and ice never move
    }
}

fn is_gas(kind: u8) -> bool {
    weight(kind) <= 1
}

// (conductivity, 1 / heat capacity), by element id. Each frame a touching pair swaps the
// smaller conductivity times their temperature difference; capacity is how much that moves
// the needle. A table, not a match: this runs twice per cell per frame.
const THERMAL: [(f32, f32); 15] = [
    (0.01, 1.0),       // EMPTY: air
    (0.03, 1.0 / 3.0), // WALL
    (0.08, 1.0 / 1.5), // SAND
    (0.25, 1.0 / 4.0), // WATER
    (0.04, 1.0 / 2.0), // WOOD
    (0.05, 1.0),       // FIRE
    (0.06, 1.0 / 3.0), // PLANT
    (0.15, 1.0 / 8.0), // LAVA
    (0.08, 1.0 / 2.0), // OIL
    (0.03, 1.0),       // SMOKE
    (0.03, 1.0),       // STEAM
    (0.1, 1.0 / 2.0),  // EMBER
    (0.15, 1.0 / 2.0), // STONE
    (0.1, 1.0 / 2.0),  // GLASS
    (0.25, 1.0 / 4.0), // ICE
];

// Hot air rises: between two gas cells, heat moves up this much faster than it spreads.
const CONVECTION: f32 = 0.3;

#[derive(Default)]
pub struct Sim {
    w: i32,
    h: i32,
    cells: Vec<Cell>,
    view: Vec<u8>,
    frame: u8,
    seed: u32,
}

impl Sim {
    pub fn new(w: i32, h: i32, seed: u32) -> Sim {
        let (w, h) = (w.max(1), h.max(1));
        let n = (w * h) as usize;
        let mut sim = Sim { w, h, cells: vec![AIR; n], view: vec![0; n * 4], frame: 0, seed: seed | 1 };
        sim.render();
        sim
    }

    pub fn step(&mut self) {
        self.frame = self.frame.wrapping_add(1);
        self.conduct();
        // Scan left-to-right one frame, right-to-left the next, so liquids don't drift one way.
        // (Alternating per row as well sorts falling water into striped sheets.)
        let flip = self.frame & 1 == 1;
        for y in (0..self.h).rev() {
            for i in 0..self.w {
                let x = if flip { self.w - 1 - i } else { i };
                let c = self.cells[self.idx(x, y)];
                if c.kind != EMPTY && c.clock != self.frame {
                    self.update(x, y, c);
                }
            }
        }
        self.render();
    }

    /// Paints discs of `kind` along the line from (x0, y0) to (x1, y1). EMPTY erases.
    pub fn paint(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, r: i32, kind: u8) {
        let steps = (x1 - x0).abs().max((y1 - y0).abs());
        for s in 0..=steps {
            let (cx, cy) = if steps == 0 { (x0, y0) } else { (x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps) };
            for y in cy - r..=cy + r {
                for x in cx - r..=cx + r {
                    if (x - cx).pow(2) + (y - cy).pow(2) > r * r || !self.inside(x, y) {
                        continue;
                    }
                    let here = self.kind(x, y);
                    if kind == EMPTY {
                        if here != EMPTY {
                            self.set(x, y, EMPTY);
                        }
                    } else if here == EMPTY && (weight(kind) == u8::MAX || self.chance(4)) {
                        // Loose elements go on scattered, so they pour instead of landing as a block.
                        self.set(x, y, kind);
                    }
                }
            }
        }
    }

    pub fn clear(&mut self) {
        self.cells.fill(AIR);
        self.render();
    }

    fn idx(&self, x: i32, y: i32) -> usize {
        (y * self.w + x) as usize
    }

    fn inside(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h
    }

    // Outside the grid counts as wall, so nothing leaves the screen.
    fn kind(&self, x: i32, y: i32) -> u8 {
        if self.inside(x, y) { self.cells[self.idx(x, y)].kind } else { WALL }
    }

    // xorshift32: fast, and seeded, so the same seed and strokes replay the same sandbox.
    fn rand(&mut self) -> u32 {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        x
    }

    fn chance(&mut self, one_in: u32) -> bool {
        self.rand() % one_in == 0
    }

    fn side(&mut self) -> i32 {
        if self.chance(2) { 1 } else { -1 }
    }

    // A brand-new cell, at the temperature it's made at.
    fn set(&mut self, x: i32, y: i32, kind: u8) {
        let r = self.rand();
        let (life, temp) = match kind {
            FIRE => (10 + r % 30, 900.0),
            EMBER => (80 + r % 120, AMBIENT),
            SMOKE => (40 + r % 60, AMBIENT),
            LAVA => (0, 1400.0),
            ICE => (0, -50.0),
            _ => (0, AMBIENT),
        };
        let i = self.idx(x, y);
        self.cells[i] = Cell { kind, shade: (r >> 24) as u8, life: life as u8, clock: self.frame, vx: 0, vy: 0, temp };
    }

    // The cell turns into something else but keeps its heat.
    fn morph(&mut self, x: i32, y: i32, kind: u8) {
        let temp = self.cells[self.idx(x, y)].temp;
        self.set(x, y, kind);
        let i = self.idx(x, y);
        self.cells[i].temp = temp;
    }

    fn swap(&mut self, x: i32, y: i32, nx: i32, ny: i32) {
        let (a, b) = (self.idx(x, y), self.idx(nx, ny));
        self.cells.swap(a, b);
        self.cells[a].clock = self.frame;
        self.cells[b].clock = self.frame;
    }

    // Whether a `kind` can move into (x, y): there's something lighter there.
    fn gives_way(&self, x: i32, y: i32, kind: u8) -> bool {
        weight(self.kind(x, y)) < weight(kind)
    }

    // Moves the cell at (x, y) into (nx, ny) if what's there is lighter.
    fn sink(&mut self, x: i32, y: i32, nx: i32, ny: i32) -> bool {
        let moves = self.gives_way(nx, ny, self.kind(x, y));
        if moves {
            self.swap(x, y, nx, ny);
        }
        moves
    }

    // Heat flows between every pair of touching cells, and the air cools off toward AMBIENT.
    // In place and pair by pair: each exchange only evens out a pair, so it can't blow up.
    fn conduct(&mut self) {
        let exchange = |cells: &mut [Cell], a: usize, b: usize, rising: bool| {
            let diff = cells[b].temp - cells[a].temp;
            if diff == 0.0 {
                return; // most of the grid: still air at room temperature
            }
            let (ka, ia) = THERMAL[cells[a].kind as usize];
            let (kb, ib) = THERMAL[cells[b].kind as usize];
            let k = if rising && diff > 0.0 && is_gas(cells[a].kind) && is_gas(cells[b].kind) { CONVECTION } else { ka.min(kb) };
            cells[a].temp += k * diff * ia;
            cells[b].temp -= k * diff * ib;
        };
        let (w, h) = (self.w as usize, self.h as usize);
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if x + 1 < w {
                    exchange(&mut self.cells, i, i + 1, false);
                }
                if y + 1 < h {
                    exchange(&mut self.cells, i, i + w, true); // b is below a
                }
                let c = &mut self.cells[i];
                if matches!(c.kind, EMPTY | SMOKE | STEAM) && c.temp != AMBIENT {
                    let d = AMBIENT - c.temp;
                    // Snap the last tenth of a degree, so settled air skips the exchanges above.
                    c.temp = if d.abs() < 0.1 { AMBIENT } else { c.temp + d * 0.02 };
                }
            }
        }
    }

    fn update(&mut self, x: i32, y: i32, c: Cell) {
        // Heat first: it can turn the cell into something else.
        let t = c.temp;
        let changed = match c.kind {
            WATER if t >= 100.0 => self.change(x, y, 100.0, STEAM, 12),
            WATER if t < -1.0 => self.change(x, y, -1.0, ICE, 12), // a little below melting, or melt water refreezes at once
            ICE if t > 0.0 => self.change(x, y, 0.0, WATER, 20),
            STEAM if t < 90.0 => self.change(x, y, 90.0, WATER, 40),
            SAND if t > 900.0 => self.change(x, y, 900.0, GLASS, 20),
            LAVA if t < 550.0 => self.change(x, y, t, STONE, 1),
            STONE if t > 1000.0 => self.change(x, y, t, LAVA, 1),
            WOOD if t > 300.0 => self.ignite(x, y, 1),
            PLANT if t > 220.0 => self.ignite(x, y, 3),
            OIL if t > 180.0 => self.ignite(x, y, 5),
            _ => false,
        };
        if changed {
            return;
        }
        match c.kind {
            SAND | STONE => self.powder(x, y),
            WATER => self.liquid(x, y, 5),
            OIL => self.liquid(x, y, 3),
            LAVA => self.lava(x, y, c),
            FIRE => self.fire(x, y, c),
            EMBER => self.ember(x, y, c),
            SMOKE | STEAM => self.gas(x, y, c),
            PLANT => self.plant(x, y),
            _ => {} // walls, wood, glass and ice just sit there
        }
    }

    // A phase change that takes (or gives off) heat: the cell holds at `at` degrees, and one
    // frame in `one_in` it turns into `into`. Holding the temperature is the latent heat: a
    // pot of water soaks up heat at 100° for a while before it's all steam.
    fn change(&mut self, x: i32, y: i32, at: f32, into: u8, one_in: u32) -> bool {
        let i = self.idx(x, y);
        self.cells[i].temp = at;
        let turns = self.chance(one_in);
        if turns {
            self.morph(x, y, into);
        }
        turns
    }

    // Fuel catches fire: oil flares up and is gone fast, wood smoulders for a while.
    fn ignite(&mut self, x: i32, y: i32, shorter: u8) -> bool {
        self.morph(x, y, EMBER);
        let i = self.idx(x, y);
        self.cells[i].life /= shorter;
        true
    }

    // How many whole cells a speed covers this frame. The fraction rounds up at random, so
    // slow speeds still add up right on average.
    fn steps(&mut self, v: i8) -> i32 {
        let v = v as i32;
        let extra = (self.rand() & 15) < (v.unsigned_abs() & 15);
        ((v.abs() >> 4) + extra as i32) * v.signum()
    }

    // Gravity and momentum for grains and liquids. Flies the cell along its velocity through
    // empty cells (a Bresenham line), pushes into anything lighter a cell at a time, slowed down,
    // and lands on anything heavier. Returns true if it's resting at (x, y) and may slide.
    fn fly(&mut self, x: i32, y: i32) -> bool {
        let i = self.idx(x, y);
        let c = &mut self.cells[i];
        c.vy = c.vy.saturating_add(GRAVITY).min(MAX_SPEED);
        c.vx -= c.vx / 16; // air drag
        let c = *c;
        let dx = self.steps(c.vx);
        let dy = if c.vy >= 0 { self.steps(c.vy).max(1) } else { self.steps(c.vy) };
        let n = dx.abs().max(dy.abs());
        let (mut ex, mut ey) = (x, y);
        let mut blocker = None;
        for s in 1..=n {
            let (nx, ny) = (x + dx * s / n, y + dy * s / n);
            if self.kind(nx, ny) != EMPTY {
                blocker = Some((nx, ny));
                break;
            }
            (ex, ey) = (nx, ny);
        }
        if (ex, ey) != (x, y) {
            self.swap(x, y, ex, ey);
        }
        let Some((bx, by)) = blocker else { return false };
        if self.gives_way(bx, by, c.kind) {
            // Something lighter in the way: push through it, slowed down. Gases barely resist;
            // liquids let things through only every other frame or so.
            let j = self.idx(ex, ey);
            self.cells[j].vx /= 2;
            self.cells[j].vy /= 2;
            if is_gas(self.kind(bx, by)) || self.chance(2) {
                self.swap(ex, ey, bx, by);
            }
            return false;
        }
        self.land(ex, ey);
        (ex, ey) == (x, y) && self.cells[self.idx(x, y)].vy <= 0
    }

    // Stopped by something. On top of more of itself that's falling too, it keeps pace, so a
    // stream stays together. Otherwise it's an impact: the momentum goes into sideways motion.
    // Grains scatter a little; liquids splash out, and a few drops bounce up.
    fn land(&mut self, x: i32, y: i32) {
        let i = self.idx(x, y);
        let c = self.cells[i];
        if c.vx != 0 && !self.gives_way(x + c.vx.signum() as i32, y, c.kind) {
            self.cells[i].vx = 0;
        }
        if c.vy < 0 && !self.gives_way(x, y - 1, c.kind) {
            self.cells[i].vy = 0;
        }
        if c.vy > 0 && !self.gives_way(x, y + 1, c.kind) {
            // (Only on its own kind: oil doesn't ride a drop of water sinking through it.)
            let below = if self.inside(x, y + 1) { self.cells[self.idx(x, y + 1)] } else { AIR };
            let under = if below.kind == c.kind { below.vy.max(0) } else { 0 };
            self.cells[i].vy = under.min(c.vy);
            let v = c.vy as i32;
            if under == 0 && v > 24 && c.vx == 0 {
                let liquid = weight(c.kind) < weight(SAND);
                let push = if liquid { v / 3 } else { v / 4 };
                self.cells[i].vx = (self.side() * push) as i8;
                if liquid && self.chance(12) {
                    self.cells[i].vy = -(v / 6) as i8;
                }
            }
        }
    }

    // Powder: falls, then slides off diagonally, or skids along in the way it was thrown.
    fn powder(&mut self, x: i32, y: i32) {
        if !self.fly(x, y) {
            return;
        }
        let i = self.idx(x, y);
        let vx = self.cells[i].vx;
        let dx = if vx != 0 { vx.signum() as i32 } else { self.side() };
        if self.sink(x, y, x + dx, y + 1) {
            return;
        }
        if vx != 0 {
            self.cells[i].vx -= vx.signum() * vx.abs().min(4); // friction
            if !self.sink(x, y, x + dx, y) {
                self.cells[i].vx = 0;
            }
            return;
        }
        self.sink(x, y, x - dx, y + 1);
    }

    // Something liquid can run across: occupied, and not itself falling.
    // Without the second part, water skates out over the top of a falling stream.
    fn settled(&self, x: i32, y: i32) -> bool {
        !self.inside(x, y) || {
            let c = self.cells[self.idx(x, y)];
            c.kind != EMPTY && c.vy <= 0
        }
    }

    // Liquid: falls like powder, else runs sideways over settled ground, up to `spread` cells
    // (more when it's already moving) and keeps going the same way, so it can shoot off ledges.
    fn liquid(&mut self, x: i32, y: i32, spread: i32) {
        if !self.fly(x, y) {
            return;
        }
        let i = self.idx(x, y);
        let vx = self.cells[i].vx;
        let dx = if vx != 0 { vx.signum() as i32 } else { self.side() };
        if self.sink(x, y, x + dx, y + 1) || self.sink(x, y, x - dx, y + 1) {
            return;
        }
        // Anything lighter is open space to spread into: water runs out under a layer of oil.
        let (me, reach) = (self.kind(x, y), spread + (vx.unsigned_abs() >> 4) as i32);
        let mut to = x;
        while to - x != dx * reach && self.gives_way(to + dx, y, me) {
            to += dx;
            if !self.settled(to, y + 1) {
                break; // an edge or a falling stream: tip over here instead of gliding on
            }
        }
        if to == x {
            self.cells[i].vx = 0;
            return;
        }
        self.swap(x, y, to, y);
        let j = self.idx(to, y);
        self.cells[j].vx = (dx * ((to - x).abs() * 4).min(48)) as i8;
    }

    // Lava: a thick, hot liquid. Its heat does the rest: it lights fuel, boils water, melts
    // sand, and crusts over into stone as it cools.
    fn lava(&mut self, x: i32, y: i32, c: Cell) {
        if c.temp > 1000.0 && self.chance(80) && self.kind(x, y - 1) == EMPTY {
            self.set(x, y - 1, FIRE);
        }
        if self.chance(2) {
            self.liquid(x, y, 1);
        }
    }

    // Flame: flickers upward, heats what it touches, and burns out into hot air or smoke.
    fn fire(&mut self, x: i32, y: i32, c: Cell) {
        if c.life == 0 {
            let next = if self.chance(3) { SMOKE } else { EMPTY };
            self.morph(x, y, next);
            return;
        }
        if self.touching(x, y, WATER) {
            self.morph(x, y, STEAM);
            return;
        }
        // Oil vapor flashes over at the touch of a flame; everything else has to heat up first.
        for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
            if self.kind(nx, ny) == OIL {
                self.ignite(nx, ny, 5);
            }
        }
        let i = self.idx(x, y);
        self.cells[i].life = c.life - 1;
        self.cells[i].temp = c.temp.max(900.0);
        let dx = (self.rand() % 3) as i32 - 1;
        if self.kind(x + dx, y - 1) == EMPTY {
            self.swap(x, y, x + dx, y - 1);
        }
    }

    fn touching(&mut self, x: i32, y: i32, kind: u8) -> bool {
        [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)].iter().any(|&(nx, ny)| self.kind(nx, ny) == kind)
    }

    // Burning material: stays put and stays hot until it's burnt, throws flames; water puts it out.
    fn ember(&mut self, x: i32, y: i32, c: Cell) {
        if c.life == 0 {
            let next = if self.chance(2) { SMOKE } else { EMPTY };
            self.morph(x, y, next);
            return;
        }
        if self.touching(x, y, WATER) {
            self.morph(x, y, SMOKE);
            return;
        }
        let i = self.idx(x, y);
        self.cells[i].life = c.life - 1;
        self.cells[i].temp = c.temp.max(700.0);
        if self.chance(3) && self.kind(x, y - 1) == EMPTY {
            self.set(x, y - 1, FIRE);
        }
    }

    // Smoke and steam drift up; smoke fades away, steam turns back into water as it cools.
    fn gas(&mut self, x: i32, y: i32, c: Cell) {
        if c.kind == SMOKE {
            if c.life == 0 {
                self.morph(x, y, EMPTY);
                return;
            }
            let i = self.idx(x, y);
            self.cells[i].life = c.life - 1;
        }
        let dx = (self.rand() % 3) as i32 - 1;
        if self.kind(x + dx, y - 1) == EMPTY {
            self.swap(x, y, x + dx, y - 1);
        } else if self.kind(x + dx, y) == EMPTY {
            self.swap(x, y, x + dx, y);
        }
    }

    // Plants drink touching water and grow into it.
    fn plant(&mut self, x: i32, y: i32) {
        let (nx, ny) = match self.rand() % 4 {
            0 => (x + 1, y),
            1 => (x - 1, y),
            2 => (x, y + 1),
            _ => (x, y - 1),
        };
        if self.kind(nx, ny) == WATER && self.chance(12) {
            self.set(nx, ny, PLANT);
        }
    }

    // What the GPU gets: element, shade, heat (temperature / 8 from -50 °C), and aux: the life
    // of flames and smoke, or how fast anything else is falling.
    fn render(&mut self) {
        for (c, v) in self.cells.iter().zip(self.view.chunks_exact_mut(4)) {
            let heat = ((c.temp + 50.0) / 8.0) as u8; // `as` saturates
            let aux = match c.kind {
                FIRE | EMBER | SMOKE => c.life,
                _ => c.vy.max(0) as u8,
            };
            v.copy_from_slice(&[c.kind, c.shade, heat, aux]);
        }
    }
}

thread_local! {
    static SIM: RefCell<Sim> = RefCell::new(Sim::default());
}

/// Starts a new, empty sandbox of w × h cells.
#[unsafe(no_mangle)]
pub extern "C" fn init(w: i32, h: i32, seed: u32) {
    SIM.with_borrow_mut(|s| *s = Sim::new(w, h, seed));
}

/// Advances one frame and refreshes the view buffer.
#[unsafe(no_mangle)]
pub extern "C" fn step() {
    SIM.with_borrow_mut(Sim::step);
}

/// Paints a line of discs from (x0, y0) to (x1, y1). Element 0 erases.
#[unsafe(no_mangle)]
pub extern "C" fn paint(x0: i32, y0: i32, x1: i32, y1: i32, radius: i32, kind: u8) {
    SIM.with_borrow_mut(|s| s.paint(x0, y0, x1, y1, radius, kind));
}

#[unsafe(no_mangle)]
pub extern "C" fn clear() {
    SIM.with_borrow_mut(Sim::clear);
}

/// Address of the w × h × 4-byte view buffer in WASM memory.
#[unsafe(no_mangle)]
pub extern "C" fn view() -> *const u8 {
    SIM.with_borrow(|s| s.view.as_ptr())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(s: &mut Sim, frames: usize) {
        for _ in 0..frames {
            s.step();
        }
    }

    fn count(s: &Sim, kind: u8) -> usize {
        s.cells.iter().filter(|c| c.kind == kind).count()
    }

    #[test]
    fn sand_falls_to_the_floor() {
        let mut s = Sim::new(5, 6, 1);
        s.set(2, 0, SAND);
        run(&mut s, 10);
        assert_eq!(s.kind(2, 5), SAND);
    }

    #[test]
    fn falling_speeds_up() {
        let mut s = Sim::new(3, 200, 1);
        s.set(1, 0, SAND);
        run(&mut s, 70); // at a cell a frame it would take 199
        assert!((0..3).any(|x| s.kind(x, 199) == SAND));
    }

    #[test]
    fn sand_sinks_through_water_and_oil_floats_on_top() {
        let mut s = Sim::new(1, 4, 1);
        s.set(0, 3, OIL);
        s.set(0, 2, WATER);
        s.set(0, 1, SAND);
        run(&mut s, 40);
        assert_eq!([s.kind(0, 1), s.kind(0, 2), s.kind(0, 3)], [OIL, WATER, SAND]);
    }

    #[test]
    fn water_levels_out() {
        let mut s = Sim::new(6, 6, 1);
        for y in 0..6 {
            s.set(0, y, WATER);
        }
        run(&mut s, 100);
        assert!((0..6).all(|x| s.kind(x, 5) == WATER));
    }

    #[test]
    fn a_pool_spills_off_a_shelf_as_a_smooth_waterfall() {
        let mut s = Sim::new(40, 60, 99);
        s.paint(0, 20, 12, 20, 0, WALL); // shelf ending at x = 12
        for y in 8..20 {
            for x in 0..12 {
                s.set(x, y, WATER);
            }
        }
        run(&mut s, 40);
        // The stream stays narrow: no sheets of water sticking out sideways. (It speeds up as
        // it falls, so it thins out into drops; row widths aren't comparable any more.)
        let width = |y: i32| (13..40).filter(|&x| s.kind(x, y) == WATER).count();
        assert!((22..44).map(width).sum::<usize>() > 10);
        assert!((22..44).all(|y| width(y) <= 4));
    }

    #[test]
    fn heat_spreads_and_is_conserved_without_air() {
        let mut s = Sim::new(10, 1, 1);
        for x in 0..10 {
            s.set(x, 0, WALL);
        }
        s.cells[0].temp = 1020.0;
        run(&mut s, 3000);
        let total: f32 = s.cells.iter().map(|c| c.temp).sum();
        assert!((total - 1200.0).abs() < 0.5, "{total}");
        assert!(s.cells[9].temp > 100.0);
    }

    #[test]
    fn a_burning_wood_block_burns_away() {
        let mut s = Sim::new(12, 12, 1);
        for y in 4..8 {
            for x in 3..9 {
                s.set(x, y, WOOD);
            }
        }
        s.set(2, 5, EMBER);
        run(&mut s, 4000);
        assert_eq!(count(&s, WOOD), 0);
    }

    #[test]
    fn flames_light_oil() {
        let mut s = Sim::new(10, 10, 1);
        for x in 0..10 {
            s.set(x, 9, OIL);
        }
        for _ in 0..10 {
            s.paint(5, 7, 5, 7, 1, FIRE); // a moment of holding the fire brush there
            s.step();
        }
        run(&mut s, 300);
        assert_eq!(count(&s, OIL), 0);
    }

    #[test]
    fn lava_meeting_water_makes_stone_and_steam() {
        let mut s = Sim::new(5, 5, 1);
        s.set(2, 3, LAVA);
        for x in 0..5 {
            s.set(x, 4, WATER);
        }
        run(&mut s, 20);
        assert!(count(&s, STEAM) > 0);
        run(&mut s, 600);
        assert_eq!((count(&s, LAVA), count(&s, STONE)), (0, 1));
    }

    #[test]
    fn lava_melts_sand_into_glass() {
        let mut s = Sim::new(8, 8, 1);
        for y in 5..8 {
            for x in 0..8 {
                s.set(x, y, SAND);
            }
        }
        for y in 2..5 {
            for x in 0..8 {
                s.set(x, y, LAVA);
            }
        }
        run(&mut s, 300);
        assert!(count(&s, GLASS) > 0);
    }

    #[test]
    fn ice_freezes_water_and_the_air_melts_it() {
        let mut s = Sim::new(12, 12, 1);
        for y in 6..12 {
            for x in 0..12 {
                s.set(x, y, ICE);
            }
        }
        for y in 7..10 {
            for x in 5..8 {
                s.set(x, y, WATER); // a pocket inside the ice
            }
        }
        run(&mut s, 200);
        assert_eq!(count(&s, WATER), 0);
        run(&mut s, 20000);
        assert_eq!(count(&s, ICE), 0);
    }

    #[test]
    fn painting_fills_only_empty_cells_and_the_eraser_clears() {
        let mut s = Sim::new(10, 10, 1);
        s.paint(5, 5, 5, 5, 3, WALL);
        assert_eq!(count(&s, WALL), 29); // every cell within radius 3
        s.paint(5, 5, 5, 5, 3, SAND);
        assert_eq!(count(&s, SAND), 0); // nothing empty under the brush
        s.paint(5, 5, 5, 5, 3, EMPTY);
        assert_eq!(count(&s, WALL), 0);
    }

    #[test]
    fn same_seed_and_strokes_replay_the_same_sandbox() {
        let play = || {
            let mut s = Sim::new(20, 20, 7);
            s.paint(10, 0, 10, 0, 4, SAND);
            s.paint(2, 8, 18, 8, 1, WATER);
            s.paint(15, 2, 15, 2, 2, LAVA);
            run(&mut s, 100);
            s.cells
        };
        assert_eq!(play(), play());
    }
}
