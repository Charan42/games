//! Falling-sand simulation for src/sand, compiled to WebAssembly.
//!
//! The grid lives in WASM memory. Each frame JS calls `step`, then reads two RGBA buffers
//! straight out of memory: `pixels` (how everything looks) and `glow` (light from fire and
//! lava, which JS blurs and adds on top). Only numbers cross the boundary, so there's no
//! wasm-bindgen: the exports at the bottom are plain `extern "C"` functions.

use std::cell::RefCell;

// Element ids. The toolbar in ../../main.ts uses the same numbers.
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
pub const EMBER: u8 = 11; // something burning: stays put, throws flames, spreads to fuel

#[derive(Clone, Copy, Default, PartialEq, Debug)]
struct Cell {
    kind: u8,
    shade: u8, // per-grain color variation, fixed when the cell is created
    life: u8,  // countdown for fire, embers, smoke and steam
    clock: u8, // frame stamp, so a cell that already moved this frame isn't moved again
}

// A falling element swaps places with anything lighter below it.
fn weight(kind: u8) -> u8 {
    match kind {
        EMPTY => 0,
        SMOKE | STEAM | FIRE => 1,
        OIL => 2,
        WATER => 3,
        LAVA => 4,
        SAND => 5,
        _ => u8::MAX, // walls, wood, plants and embers never move
    }
}

#[derive(Default)]
pub struct Sim {
    w: i32,
    h: i32,
    cells: Vec<Cell>,
    pixels: Vec<u8>,
    glow: Vec<u8>,
    frame: u8,
    seed: u32,
}

impl Sim {
    pub fn new(w: i32, h: i32, seed: u32) -> Sim {
        let (w, h) = (w.max(1), h.max(1));
        let n = (w * h) as usize;
        let mut sim = Sim {
            w,
            h,
            cells: vec![Cell::default(); n],
            pixels: vec![0; n * 4],
            glow: vec![0; n * 4],
            frame: 0,
            seed: seed | 1, // xorshift needs a non-zero seed
        };
        sim.render();
        sim
    }

    pub fn step(&mut self) {
        self.frame = self.frame.wrapping_add(1);
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
        self.cells.fill(Cell::default());
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

    fn neighbor(&mut self, x: i32, y: i32) -> (i32, i32) {
        match self.rand() % 4 {
            0 => (x + 1, y),
            1 => (x - 1, y),
            2 => (x, y + 1),
            _ => (x, y - 1),
        }
    }

    fn set(&mut self, x: i32, y: i32, kind: u8) {
        let r = self.rand();
        let life = match kind {
            FIRE => 10 + r % 30,
            EMBER => 80 + r % 120,
            SMOKE => 40 + r % 60,
            STEAM => 60 + r % 80,
            _ => 0,
        };
        let i = self.idx(x, y);
        self.cells[i] = Cell { kind, shade: (r >> 24) as u8, life: life as u8, clock: self.frame };
    }

    fn swap(&mut self, x: i32, y: i32, nx: i32, ny: i32) {
        let (a, b) = (self.idx(x, y), self.idx(nx, ny));
        self.cells.swap(a, b);
        self.cells[a].clock = self.frame;
        self.cells[b].clock = self.frame;
    }

    // Moves the cell at (x, y) into (nx, ny) if what's there is lighter.
    fn sink(&mut self, x: i32, y: i32, nx: i32, ny: i32) -> bool {
        let moves = weight(self.kind(nx, ny)) < weight(self.kind(x, y));
        if moves {
            self.swap(x, y, nx, ny);
        }
        moves
    }

    fn update(&mut self, x: i32, y: i32, c: Cell) {
        match c.kind {
            SAND => self.fall(x, y),
            WATER => self.flow(x, y, 4),
            OIL => self.flow(x, y, 3),
            LAVA => self.lava(x, y),
            FIRE => self.fire(x, y, c),
            EMBER => self.ember(x, y, c),
            SMOKE | STEAM => self.gas(x, y, c),
            PLANT => self.plant(x, y),
            _ => {} // walls and wood just sit there
        }
    }

    // Powder: straight down, else slide off diagonally.
    fn fall(&mut self, x: i32, y: i32) {
        if self.sink(x, y, x, y + 1) {
            return;
        }
        let dx = if self.chance(2) { 1 } else { -1 };
        if !self.sink(x, y, x + dx, y + 1) {
            self.sink(x, y, x - dx, y + 1);
        }
    }

    // Something liquid can run across: occupied, and not itself on the move this frame.
    // Without the second part, water skates out over the top of a falling stream.
    fn settled(&self, x: i32, y: i32) -> bool {
        !self.inside(x, y) || {
            let c = self.cells[self.idx(x, y)];
            c.kind != EMPTY && c.clock != self.frame
        }
    }

    // Liquid: falls like powder, else runs sideways over settled ground, up to `spread` cells.
    fn flow(&mut self, x: i32, y: i32, spread: i32) {
        if self.sink(x, y, x, y + 1) {
            return;
        }
        let dx = if self.chance(2) { 1 } else { -1 };
        if self.sink(x, y, x + dx, y + 1) || self.sink(x, y, x - dx, y + 1) {
            return;
        }
        if !self.settled(x, y + 1) {
            // What's below is still falling: wait for it, and count as falling too, so
            // nothing above skates across the top of this stream.
            let i = self.idx(x, y);
            self.cells[i].clock = self.frame;
            return;
        }
        let mut to = x;
        while to - x != dx * spread && self.kind(to + dx, y) == EMPTY {
            to += dx;
            if !self.settled(to, y + 1) {
                break; // an edge or a falling stream: tip over here instead of gliding on
            }
        }
        if to != x {
            self.swap(x, y, to, y);
        }
    }

    // Lava: a thick liquid that sets fuel alight and turns water into stone and steam.
    fn lava(&mut self, x: i32, y: i32) {
        let (nx, ny) = self.neighbor(x, y);
        match self.kind(nx, ny) {
            WATER => {
                self.set(x, y, WALL);
                self.set(nx, ny, STEAM);
                return;
            }
            WOOD | PLANT | OIL if self.chance(4) => self.ignite(nx, ny),
            _ => {}
        }
        if self.chance(60) && self.kind(x, y - 1) == EMPTY {
            self.set(x, y - 1, FIRE);
        }
        if self.chance(2) {
            self.flow(x, y, 1);
        }
    }

    // Fuel catches fire: oil flares up and is gone fast, wood smoulders for a while.
    fn ignite(&mut self, x: i32, y: i32) {
        let fuel = self.kind(x, y);
        self.set(x, y, EMBER);
        let i = self.idx(x, y);
        let life = &mut self.cells[i].life;
        *life = match fuel {
            OIL => *life / 5,
            PLANT => *life / 3,
            _ => *life,
        };
    }

    // Flame: flickers upward, spreads to fuel, and burns out, sometimes into smoke.
    fn fire(&mut self, x: i32, y: i32, c: Cell) {
        if c.life == 0 {
            let next = if self.chance(3) { SMOKE } else { EMPTY };
            self.set(x, y, next);
            return;
        }
        let (nx, ny) = self.neighbor(x, y);
        match self.kind(nx, ny) {
            WATER => {
                self.set(x, y, STEAM);
                return;
            }
            WOOD | PLANT if self.chance(8) => self.ignite(nx, ny),
            OIL => self.ignite(nx, ny),
            _ => {}
        }
        let i = self.idx(x, y);
        self.cells[i].life = c.life - 1;
        let dx = (self.rand() % 3) as i32 - 1;
        if self.kind(x + dx, y - 1) == EMPTY {
            self.swap(x, y, x + dx, y - 1);
        }
    }

    // Burning material: stays put, lights touching fuel, throws flames; water puts it out.
    fn ember(&mut self, x: i32, y: i32, c: Cell) {
        if c.life == 0 {
            let next = if self.chance(2) { SMOKE } else { EMPTY };
            self.set(x, y, next);
            return;
        }
        let i = self.idx(x, y);
        self.cells[i].life = c.life - 1;
        for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
            match self.kind(nx, ny) {
                WATER => {
                    self.set(x, y, SMOKE);
                    self.set(nx, ny, STEAM);
                    return;
                }
                WOOD if self.chance(20) => self.ignite(nx, ny),
                PLANT if self.chance(8) => self.ignite(nx, ny),
                OIL if self.chance(2) => self.ignite(nx, ny),
                _ => {}
            }
        }
        if self.chance(3) && self.kind(x, y - 1) == EMPTY {
            self.set(x, y - 1, FIRE);
        }
    }

    // Smoke and steam drift up and fade; steam sometimes condenses back into rain.
    fn gas(&mut self, x: i32, y: i32, c: Cell) {
        if c.life == 0 {
            let next = if c.kind == STEAM && self.chance(3) { WATER } else { EMPTY };
            self.set(x, y, next);
            return;
        }
        let i = self.idx(x, y);
        self.cells[i].life = c.life - 1;
        let dx = (self.rand() % 3) as i32 - 1;
        if self.kind(x + dx, y - 1) == EMPTY {
            self.swap(x, y, x + dx, y - 1);
        } else if self.kind(x + dx, y) == EMPTY {
            self.swap(x, y, x + dx, y);
        }
    }

    // Plants drink touching water and grow into it.
    fn plant(&mut self, x: i32, y: i32) {
        let (nx, ny) = self.neighbor(x, y);
        if self.kind(nx, ny) == WATER && self.chance(12) {
            self.set(nx, ny, PLANT);
        }
    }

    fn render(&mut self) {
        let frame = self.frame;
        let out = self.pixels.chunks_exact_mut(4).zip(self.glow.chunks_exact_mut(4));
        for (c, (px, glow)) in self.cells.iter().zip(out) {
            let (rgb, lit) = color(*c, frame);
            px.copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            glow.copy_from_slice(&if lit { [rgb[0], rgb[1], rgb[2], 255] } else { [0; 4] });
        }
    }
}

const BACKGROUND: [u8; 3] = [11, 13, 18];

// How a cell looks, and whether it gives off light.
fn color(c: Cell, frame: u8) -> ([u8; 3], bool) {
    // Each grain keeps a slight darkening of its own, so materials look grainy.
    let k = 224 + (c.shade >> 3) as u16;
    let tint = |rgb: [u8; 3]| rgb.map(|v| (v as u16 * k >> 8) as u8);
    // Fire, embers and lava shimmer: a per-cell brightness that changes every frame.
    let flicker = c.shade.wrapping_add(frame.wrapping_mul(7)) >> 2; // 0..=63
    match c.kind {
        EMPTY => (BACKGROUND, false),
        WALL => (tint([112, 114, 124]), false),
        SAND => (tint([226, 194, 117]), false),
        WATER => (tint([38, 110, 222]), false),
        WOOD => (tint([122, 80, 44]), false),
        PLANT => (tint([62, 178, 80]), false),
        OIL => (tint([92, 70, 48]), false),
        LAVA => ([255, 70 + flicker, 20], true),
        EMBER => ([190 + flicker, 40 + flicker / 2, 10], true),
        FIRE => {
            let heat = c.life.min(40); // young flames burn yellow, old ones red
            ([255, 80 + heat * 4, 20 + heat * 2], true)
        }
        SMOKE => (fade([64, 64, 70], c.life), false),
        STEAM => (fade([190, 200, 215], c.life), false),
        _ => ([255, 0, 255], false),
    }
}

// Smoke and steam fade into the background as they run out of life.
fn fade(rgb: [u8; 3], life: u8) -> [u8; 3] {
    let t = life.min(40) as u16;
    std::array::from_fn(|i| ((BACKGROUND[i] as u16 * (40 - t) + rgb[i] as u16 * t) / 40) as u8)
}

thread_local! {
    static SIM: RefCell<Sim> = RefCell::new(Sim::default());
}

/// Starts a new, empty sandbox of w × h cells.
#[unsafe(no_mangle)]
pub extern "C" fn init(w: i32, h: i32, seed: u32) {
    SIM.with_borrow_mut(|s| *s = Sim::new(w, h, seed));
}

/// Advances one frame and redraws both pixel buffers.
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

/// Address of the w × h RGBA color buffer in WASM memory.
#[unsafe(no_mangle)]
pub extern "C" fn pixels() -> *const u8 {
    SIM.with_borrow(|s| s.pixels.as_ptr())
}

/// Address of the RGBA glow buffer: fire and lava colors, transparent everywhere else.
#[unsafe(no_mangle)]
pub extern "C" fn glow() -> *const u8 {
    SIM.with_borrow(|s| s.glow.as_ptr())
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
    fn sand_sinks_through_water_and_oil_floats_on_top() {
        let mut s = Sim::new(1, 4, 1);
        s.set(0, 3, OIL);
        s.set(0, 2, WATER);
        s.set(0, 1, SAND);
        run(&mut s, 10);
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
        // Neighboring rows of the falling stream are about as wide as each other:
        // no sheets of water sticking out sideways on every other row.
        let width = |y: i32| (13..40).filter(|&x| s.kind(x, y) == WATER).count() as i32;
        assert!((22..44).all(|y| (width(y) - width(y + 1)).abs() <= 2));
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
    fn lava_turns_water_into_stone_and_steam() {
        let mut s = Sim::new(3, 3, 1);
        s.set(1, 1, LAVA);
        s.set(1, 2, WATER);
        run(&mut s, 30);
        assert_eq!((count(&s, LAVA), count(&s, WALL)), (0, 1));
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
            run(&mut s, 100);
            s.cells
        };
        assert_eq!(play(), play());
    }
}

