//! Finding a move: iterative-deepening alpha-beta (principal variation search) with a
//! transposition table, quiescence search, null-move pruning, late-move reductions, and
//! killer and history move ordering.
//!
//! Weaker levels search shallower and add seeded noise to each root move's score, so they
//! play plausible but imperfect moves, and the same seed always picks the same one.

use crate::board::*;
use crate::eval::evaluate;

pub const MATE: i32 = 30_000;
const INF: i32 = 32_000;
const MAX_PLY: usize = 96;
const TT_BITS: u32 = 18; // 2^18 entries × 16 bytes = 4 MB

#[derive(Clone, Copy, Default)]
struct Entry {
    key: u64,
    mv: Move,
    score: i16,
    depth: i8,
    bound: u8,
}
const EXACT: u8 = 1;
const LOWER: u8 = 2; // the score is at least this (a beta cutoff)
const UPPER: u8 = 3; // at most this (nothing beat alpha)

pub struct Search {
    tt: Vec<Entry>,
    killers: [[Move; 2]; MAX_PLY],
    history: [[i32; 128]; 16],
    deadline: f64,
    can_stop: bool,
    stop: bool,
    pub nodes: u64,
    pub depth: u32,
    pub score: i32,
}

impl Default for Search {
    fn default() -> Self {
        Search {
            tt: vec![Entry::default(); 1 << TT_BITS],
            killers: [[0; 2]; MAX_PLY],
            history: [[0; 128]; 16],
            deadline: 0.0,
            can_stop: false,
            stop: false,
            nodes: 0,
            depth: 0,
            score: 0,
        }
    }
}

// Milliseconds from some fixed start. In the browser it's performance.now(), imported from JS.
#[cfg(target_arch = "wasm32")]
fn clock() -> f64 {
    #[link(wasm_import_module = "env")]
    unsafe extern "C" {
        fn now() -> f64;
    }
    unsafe { now() }
}
#[cfg(not(target_arch = "wasm32"))]
fn clock() -> f64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

// Mate scores are stored relative to the node, so a mate found at one depth reads right at another.
fn to_tt(s: i32, ply: usize) -> i32 {
    if s > MATE - 1000 { s + ply as i32 } else if s < -MATE + 1000 { s - ply as i32 } else { s }
}
fn from_tt(s: i32, ply: usize) -> i32 {
    if s > MATE - 1000 { s - ply as i32 } else if s < -MATE + 1000 { s + ply as i32 } else { s }
}

const VICTIM: [i32; 7] = [0, 100, 320, 330, 500, 900, 0];

impl Search {
    /// The best move within `ms` milliseconds or `max_depth` plies, whichever comes first.
    /// `noise` is the most centipawns a root move's score may be nudged up or down.
    pub fn think(&mut self, b: &mut Board, ms: f64, max_depth: u32, noise: i32, seed: u32) -> Option<Move> {
        let start = clock();
        self.deadline = start + ms;
        self.stop = false;
        self.nodes = 0;
        self.killers = [[0; 2]; MAX_PLY];
        for row in self.history.iter_mut() {
            for h in row.iter_mut() {
                *h /= 8;
            }
        }

        let mut list = MoveList::new();
        b.legal(&mut list);
        let mut rng = seed as u64 | 1;
        let mut root: Vec<(Move, i32)> = list
            .as_slice()
            .iter()
            .map(|&m| {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                let n = if noise > 0 { (rng % (2 * noise as u64 + 1)) as i32 - noise } else { 0 };
                (m, n)
            })
            .collect();
        let first = *root.first()?;
        (self.depth, self.score) = (0, 0);
        if root.len() == 1 {
            return Some(first.0);
        }

        for depth in 1..=max_depth.clamp(1, MAX_PLY as u32 - 8) {
            self.can_stop = depth > 1; // always finish depth 1, so there's a move to play
            let score = self.root(b, &mut root, depth as i32);
            if self.stop {
                break;
            }
            (self.depth, self.score) = (depth, score);
            if noise == 0 && score.abs() > MATE - 1000 {
                break; // found a forced mate (or can't avoid one): searching deeper won't change it
            }
            if clock() - start > ms * 0.55 {
                break; // the next depth takes a few times longer and wouldn't finish
            }
        }
        Some(root[0].0)
    }

    // One iteration over the root moves; the best is moved to the front, so it's searched
    // first next time and is the answer if time runs out.
    fn root(&mut self, b: &mut Board, root: &mut [(Move, i32)], depth: i32) -> i32 {
        let mut best = -INF;
        let mut best_i = 0;
        for i in 0..root.len() {
            let (m, noise) = root[i];
            b.make(m);
            // A move only needs to beat the best so far after both get their noise.
            let alpha = if best == -INF { -INF } else { best - noise };
            let mut s = if best == -INF {
                -self.negamax(b, depth - 1, -INF, INF, 1, true)
            } else {
                -self.negamax(b, depth - 1, -alpha - 1, -alpha, 1, true)
            };
            if best != -INF && s > alpha && !self.stop {
                s = -self.negamax(b, depth - 1, -INF, -alpha, 1, true);
            }
            b.unmake();
            if self.stop {
                break;
            }
            if s + noise > best {
                best = s + noise;
                best_i = i;
            }
        }
        root[..=best_i].rotate_right(1);
        best
    }

    fn out_of_time(&mut self) -> bool {
        if self.nodes & 1023 == 0 && self.can_stop && clock() > self.deadline {
            self.stop = true;
        }
        self.stop
    }

    fn negamax(&mut self, b: &mut Board, mut depth: i32, mut alpha: i32, beta: i32, ply: usize, allow_null: bool) -> i32 {
        if b.halfmove >= 100 || b.repetitions() > 0 {
            return 0;
        }
        let in_check = b.in_check();
        if in_check {
            depth += 1; // never stop searching with a king in check
        }
        if depth <= 0 || ply >= MAX_PLY - 1 {
            return self.quiesce(b, alpha, beta, ply);
        }
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let pv = beta - alpha > 1;

        let slot = (b.hash >> (64 - TT_BITS)) as usize;
        let e = self.tt[slot];
        let tt_move = if e.key == b.hash { e.mv } else { 0 };
        if e.key == b.hash && e.depth as i32 >= depth && !pv {
            let s = from_tt(e.score as i32, ply);
            if e.bound == EXACT || (e.bound == LOWER && s >= beta) || (e.bound == UPPER && s <= alpha) {
                return s;
            }
        }

        if !in_check && !pv {
            let stand = evaluate(b);
            // Reverse futility: far enough ahead that a shallow search can't lose it all.
            if depth <= 3 && stand - 110 * depth >= beta && beta.abs() < MATE - 1000 {
                return stand;
            }
            // Null move: if passing still leaves us above beta, a real move surely will. Not with
            // pawns alone, where passing can be the only thing that doesn't lose (zugzwang).
            if allow_null && depth >= 3 && stand >= beta && self.has_pieces(b) {
                b.make_null();
                let r = if depth > 6 { 3 } else { 2 };
                let s = -self.negamax(b, depth - 1 - r, -beta, -beta + 1, ply + 1, false);
                b.unmake_null();
                if self.stop {
                    return 0;
                }
                if s >= beta {
                    return if s > MATE - 1000 { beta } else { s };
                }
            }
        }

        let mut list = MoveList::new();
        b.generate(&mut list, false);
        let mut scores = [0i32; 256];
        for (i, &m) in list.as_slice().iter().enumerate() {
            scores[i] = self.order(b, m, tt_move, ply);
        }

        let alpha0 = alpha;
        let mut best = -INF;
        let mut best_move = 0;
        let mut legal = 0;
        for i in 0..list.len {
            let m = pick(&mut list, &mut scores, i);
            if !b.make(m) {
                continue;
            }
            legal += 1;
            let quiet = m & CAPTURE == 0 && promo(m) == 0;
            let mut s;
            if legal == 1 {
                s = -self.negamax(b, depth - 1, -beta, -alpha, ply + 1, true);
            } else {
                // Late, quiet moves are probably bad: look at them less deeply first.
                let r = if depth >= 3 && legal > 3 && quiet && !in_check && !b.in_check() {
                    1 + (legal > 10) as i32 + (depth > 8) as i32
                } else {
                    0
                };
                s = -self.negamax(b, depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
                if s > alpha && r > 0 {
                    s = -self.negamax(b, depth - 1, -alpha - 1, -alpha, ply + 1, true);
                }
                if s > alpha && s < beta {
                    s = -self.negamax(b, depth - 1, -beta, -alpha, ply + 1, true);
                }
            }
            b.unmake();
            if self.stop {
                return 0;
            }
            if s > best {
                best = s;
                best_move = m;
                if s > alpha {
                    alpha = s;
                    if s >= beta {
                        if quiet {
                            let k = &mut self.killers[ply];
                            if k[0] != m {
                                k[1] = k[0];
                                k[0] = m;
                            }
                            let h = &mut self.history[b.sq[from(m)] as usize][to(m)];
                            *h += depth * depth;
                            if *h > 50_000 {
                                self.history.iter_mut().flatten().for_each(|h| *h /= 2);
                            }
                        }
                        break;
                    }
                }
            }
        }
        if legal == 0 {
            return if in_check { -MATE + ply as i32 } else { 0 };
        }

        let bound = if best >= beta { LOWER } else if best > alpha0 { EXACT } else { UPPER };
        if e.key != b.hash || depth >= e.depth as i32 || bound == EXACT {
            self.tt[slot] = Entry { key: b.hash, mv: best_move, score: to_tt(best, ply) as i16, depth: depth as i8, bound };
        }
        best
    }

    // Captures only, until the position is quiet, so the evaluation never stops mid-exchange.
    fn quiesce(&mut self, b: &mut Board, mut alpha: i32, beta: i32, ply: usize) -> i32 {
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let stand = evaluate(b);
        if stand >= beta || ply >= MAX_PLY - 1 {
            return stand;
        }
        alpha = alpha.max(stand);

        let mut list = MoveList::new();
        b.generate(&mut list, true);
        let mut scores = [0i32; 256];
        for (i, &m) in list.as_slice().iter().enumerate() {
            scores[i] = self.order(b, m, 0, ply);
        }
        for i in 0..list.len {
            let m = pick(&mut list, &mut scores, i);
            // Delta pruning: even winning this piece for free wouldn't reach alpha.
            let gain = VICTIM[kind(b.sq[to(m)]) as usize].max(if m & EN_PASSANT != 0 { 100 } else { 0 });
            if promo(m) == 0 && stand + gain + 200 < alpha {
                continue;
            }
            if !b.make(m) {
                continue;
            }
            let s = -self.quiesce(b, -beta, -alpha, ply + 1);
            b.unmake();
            if self.stop {
                return 0;
            }
            if s >= beta {
                return s;
            }
            alpha = alpha.max(s);
        }
        alpha
    }

    // Move ordering: the table's move, then captures (most valuable victim, least valuable
    // attacker), promotions, the killers, and quiet moves by history.
    fn order(&self, b: &Board, m: Move, tt_move: Move, ply: usize) -> i32 {
        if m == tt_move {
            return 1_000_000;
        }
        let attacker = kind(b.sq[from(m)]) as i32;
        if m & CAPTURE != 0 {
            let victim = if m & EN_PASSANT != 0 { 100 } else { VICTIM[kind(b.sq[to(m)]) as usize] };
            return 100_000 + victim * 10 - attacker + if promo(m) == QUEEN { 5000 } else { 0 };
        }
        if promo(m) == QUEEN {
            return 95_000;
        }
        if promo(m) != 0 {
            return -10_000; // underpromotions last
        }
        if self.killers[ply][0] == m {
            return 90_000;
        }
        if self.killers[ply][1] == m {
            return 89_000;
        }
        self.history[b.sq[from(m)] as usize][to(m)]
    }

    fn has_pieces(&self, b: &Board) -> bool {
        let us = b.side;
        (0..128).any(|sq| {
            let p = b.sq[sq];
            p != 0 && color(p) == us && !matches!(kind(p), PAWN | KING)
        })
    }
}

// Swaps the best-scoring remaining move into slot i and returns it (a lazy selection sort:
// after a cutoff, the rest never get sorted).
fn pick(list: &mut MoveList, scores: &mut [i32; 256], i: usize) -> Move {
    let mut best = i;
    for j in i + 1..list.len {
        if scores[j] > scores[best] {
            best = j;
        }
    }
    list.moves.swap(i, best);
    scores.swap(i, best);
    list.moves[i]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn best(fen: &str, depth: u32) -> (String, i32) {
        let mut b = Board::from_fen(fen).unwrap();
        let mut s = Search::default();
        let m = s.think(&mut b, 60_000.0, depth, 0, 1).unwrap();
        let sq = |q: usize| format!("{}{}", (b'a' + (q & 7) as u8) as char, (q >> 4) + 1);
        (format!("{}{}", sq(from(m)), sq(to(m))), s.score)
    }

    #[test]
    fn mates_in_one() {
        assert_eq!(best("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", 3).0, "d1d8"); // back rank
        assert_eq!(best("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", 3).0, "h5f7"); // scholar's mate
    }

    #[test]
    fn mate_in_two_is_scored_as_mate() {
        // Queen sacrifice, then a smothered mate: 1. Qg8+ Rxg8 2. Nf7#.
        let (m, score) = best("r6k/6pp/7N/8/8/1Q6/6PP/6K1 w - - 0 1", 5);
        assert_eq!(m, "b3g8");
        assert_eq!(score, MATE - 3);
    }

    #[test]
    fn takes_a_free_queen_and_keeps_its_own() {
        assert_eq!(best("4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1", 4).0, "d2d5");
        // Black's queen is attacked by a pawn; it must move, not be traded for nothing.
        let mut b = Board::from_fen("rnb1kbnr/pppp1ppp/8/4q3/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 3").unwrap();
        let m = Search::default().think(&mut b, 60_000.0, 4, 0, 1).unwrap();
        assert_eq!(from(m), 0x44); // the queen, on e5...
        assert!(to(m) != 0x33 && to(m) != 0x14); // ...and not into a defended pawn
    }

    #[test]
    fn same_seed_same_move_and_noise_changes_play() {
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
        let pick = |seed| {
            let mut b = Board::from_fen(fen).unwrap();
            Search::default().think(&mut b, 60_000.0, 2, 80, seed).unwrap()
        };
        assert_eq!(pick(5), pick(5));
        let distinct: std::collections::HashSet<_> = (1..40).map(pick).collect();
        assert!(distinct.len() > 2);
    }

    #[test]
    fn stops_on_time() {
        let mut b = Board::default();
        let mut s = Search::default();
        let t = clock();
        s.think(&mut b, 150.0, 64, 0, 1).unwrap();
        assert!(clock() - t < 1500.0); // generous: debug builds on a busy machine
        assert!(s.depth >= 2);
    }
}

#[cfg(test)]
mod bench {
    use super::*;

    // cargo test -p chess --release -- --ignored --nocapture
    #[test]
    #[ignore]
    fn speed() {
        for fen in [START, "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"] {
            let mut b = Board::from_fen(fen).unwrap();
            let mut s = Search::default();
            let t = clock();
            s.think(&mut b, 1000.0, 64, 0, 1);
            let ms = clock() - t;
            println!("depth {} score {} nodes {} in {ms:.0} ms ({:.0} knps)", s.depth, s.score, s.nodes, s.nodes as f64 / ms);
        }
    }

    #[test]
    #[ignore]
    fn levels() {
        // (ms, depth, noise) as the page uses them
        let levels = [("easy", 300.0, 1, 220), ("medium", 400.0, 3, 50), ("hard", 250.0, 64, 0)];
        for (a, b) in [(2, 0), (2, 1), (1, 0)] {
            let mut score = 0.0;
            for g in 0..6u32 {
                let mut board = Board::default();
                let (mut sa, mut sb) = (Search::default(), Search::default());
                let a_white = g % 2 == 0;
                let mut result = 0.5;
                for ply in 0..240u32 {
                    let st = board.status();
                    if st != Status::Playing {
                        if st == Status::Checkmate {
                            let white_won = board.side == BLACK;
                            result = if white_won == a_white { 1.0 } else { 0.0 };
                        }
                        break;
                    }
                    let white = board.side == WHITE;
                    let (s, l) = if white == a_white { (&mut sa, levels[a]) } else { (&mut sb, levels[b]) };
                    let m = s.think(&mut board, l.1, l.2, l.3, g * 1000 + ply + 1).unwrap();
                    board.make(m);
                }
                score += result;
            }
            println!("{} vs {}: {score}/6", levels[a].0, levels[b].0);
        }
    }
}
