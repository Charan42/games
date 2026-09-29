//! Static evaluation in centipawns, from the point of view of the side to move.
//!
//! Every term has a middlegame and an endgame value, blended by how much material is left
//! (the "phase"): a king should hide early and march late; a passed pawn matters more as the
//! board empties.

use crate::board::*;

const VALUE_MG: [i32; 7] = [0, 100, 320, 335, 490, 960, 0];
const VALUE_EG: [i32; 7] = [0, 125, 300, 320, 530, 990, 0];
const PHASE: [i32; 7] = [0, 0, 1, 1, 2, 4, 0];
const FULL_PHASE: i32 = 24;

// Piece-square tables from White's side, written as the board looks: rank 8 on the first
// line. Black reads them mirrored.
#[rustfmt::skip]
const PST_MG: [[i32; 64]; 7] = [
    [0; 64],
    [ // pawn: take the center, keep the king's pawns home
          0,   0,   0,   0,   0,   0,   0,   0,
         45,  50,  55,  60,  60,  55,  50,  45,
         14,  18,  26,  34,  34,  26,  18,  14,
          4,   8,  12,  24,  24,  12,   8,   4,
          0,   2,   6,  20,  20,   6,   2,   0,
          2,   0,  -4,   4,   4,  -4,   0,   2,
          4,   6,   6, -16, -16,   6,   6,   4,
          0,   0,   0,   0,   0,   0,   0,   0,
    ],
    [ // knight: centralize
        -50, -36, -26, -20, -20, -26, -36, -50,
        -34, -16,   0,   4,   4,   0, -16, -34,
        -24,   4,  12,  16,  16,  12,   4, -24,
        -20,   6,  16,  22,  22,  16,   6, -20,
        -20,   0,  14,  20,  20,  14,   0, -20,
        -24,   2,  10,  12,  12,  10,   2, -24,
        -34, -16,   0,   4,   4,   0, -16, -34,
        -50, -30, -26, -20, -20, -26, -30, -50,
    ],
    [ // bishop: long diagonals, off the back rank
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10,   0,   0,   0,   0,   0,   0, -10,
        -10,   0,   6,  10,  10,   6,   0, -10,
        -10,   6,   6,  12,  12,   6,   6, -10,
        -10,   0,  12,  12,  12,  12,   0, -10,
        -10,  10,  10,   8,   8,  10,  10, -10,
        -10,  12,   0,   2,   2,   0,  12, -10,
        -20, -10, -14, -10, -10, -14, -10, -20,
    ],
    [ // rook: the seventh rank, and the center files once castled
          4,   6,   8,  10,  10,   8,   6,   4,
         18,  22,  22,  22,  22,  22,  22,  18,
         -4,   0,   2,   4,   4,   2,   0,  -4,
         -6,  -2,   0,   2,   2,   0,  -2,  -6,
         -6,  -2,   0,   2,   2,   0,  -2,  -6,
         -6,  -2,   0,   2,   2,   0,  -2,  -6,
         -8,  -4,   0,   2,   2,   0,  -4,  -8,
         -4,  -2,   2,   8,   8,   4,  -2,  -4,
    ],
    [ // queen: a little central, not out early
        -20, -10, -10,  -4,  -4, -10, -10, -20,
        -10,   0,   0,   0,   0,   0,   0, -10,
        -10,   0,   4,   4,   4,   4,   0, -10,
         -4,   0,   4,   6,   6,   4,   0,  -4,
         -4,   0,   4,   6,   6,   4,   0,  -4,
        -10,   2,   4,   4,   4,   4,   0, -10,
        -10,   0,   2,   0,   0,   0,   0, -10,
        -20, -10, -10,  -2,  -6, -10, -10, -20,
    ],
    [ // king: tucked away behind its pawns
        -40, -45, -45, -50, -50, -45, -45, -40,
        -40, -45, -45, -50, -50, -45, -45, -40,
        -40, -45, -45, -50, -50, -45, -45, -40,
        -35, -40, -40, -45, -45, -40, -40, -35,
        -25, -30, -30, -40, -40, -30, -30, -25,
        -12, -20, -20, -24, -24, -20, -20, -12,
         14,  14,  -4,  -8,  -8,  -4,  16,  14,
         18,  30,  12,  -4,   0,   8,  32,  20,
    ],
];

#[rustfmt::skip]
const PST_EG: [[i32; 64]; 7] = [
    [0; 64],
    [ // pawn: every step closer to promoting counts
          0,   0,   0,   0,   0,   0,   0,   0,
         60,  60,  56,  52,  52,  56,  60,  60,
         36,  36,  32,  28,  28,  32,  36,  36,
         20,  18,  14,  12,  12,  14,  18,  20,
         10,   8,   6,   4,   4,   6,   8,  10,
          4,   4,   2,   0,   0,   2,   4,   4,
          2,   2,   0,   0,   0,   0,   2,   2,
          0,   0,   0,   0,   0,   0,   0,   0,
    ],
    [ // knight
        -40, -30, -20, -16, -16, -20, -30, -40,
        -30, -12,  -2,   2,   2,  -2, -12, -30,
        -20,   0,  10,  14,  14,  10,   0, -20,
        -16,   4,  14,  20,  20,  14,   4, -16,
        -16,   4,  14,  20,  20,  14,   4, -16,
        -20,   0,  10,  14,  14,  10,   0, -20,
        -30, -12,  -2,   2,   2,  -2, -12, -30,
        -40, -30, -20, -16, -16, -20, -30, -40,
    ],
    [ // bishop
        -14,  -8,  -8,  -6,  -6,  -8,  -8, -14,
         -8,   0,   0,   2,   2,   0,   0,  -8,
         -8,   0,   6,   6,   6,   6,   0,  -8,
         -6,   2,   6,  10,  10,   6,   2,  -6,
         -6,   2,   6,  10,  10,   6,   2,  -6,
         -8,   0,   6,   6,   6,   6,   0,  -8,
         -8,   0,   0,   2,   2,   0,   0,  -8,
        -14,  -8,  -8,  -6,  -6,  -8,  -8, -14,
    ],
    [ // rook
          8,   8,   8,   8,   8,   8,   8,   8,
         12,  12,  12,  12,  12,  12,  12,  12,
          2,   2,   2,   2,   2,   2,   2,   2,
          0,   0,   0,   0,   0,   0,   0,   0,
          0,   0,   0,   0,   0,   0,   0,   0,
         -2,  -2,  -2,  -2,  -2,  -2,  -2,  -2,
         -4,  -4,  -4,  -4,  -4,  -4,  -4,  -4,
         -6,  -4,  -2,   0,   0,  -2,  -4,  -6,
    ],
    [ // queen
        -16,  -8,  -8,  -4,  -4,  -8,  -8, -16,
         -8,   0,   4,   6,   6,   4,   0,  -8,
         -8,   4,   8,  10,  10,   8,   4,  -8,
         -4,   6,  10,  14,  14,  10,   6,  -4,
         -4,   6,  10,  14,  14,  10,   6,  -4,
         -8,   4,   8,  10,  10,   8,   4,  -8,
         -8,   0,   4,   6,   6,   4,   0,  -8,
        -16,  -8,  -8,  -4,  -4,  -8,  -8, -16,
    ],
    [ // king: come to the center and fight
        -45, -30, -24, -18, -18, -24, -30, -45,
        -28, -12,  -4,   2,   2,  -4, -12, -28,
        -24,  -4,  16,  22,  22,  16,  -4, -24,
        -24,  -2,  22,  30,  30,  22,  -2, -24,
        -24,  -2,  22,  30,  30,  22,  -2, -24,
        -24,  -6,  14,  20,  20,  14,  -6, -24,
        -30, -20,  -4,   0,   0,  -4, -20, -30,
        -45, -32, -26, -24, -24, -26, -32, -45,
    ],
];

// Mobility: centipawns per reachable square beyond a typical count, by kind.
const MOB_BASE: [i32; 7] = [0, 0, 4, 6, 7, 13, 0];
const MOB_MG: [i32; 7] = [0, 0, 4, 5, 2, 1, 0];
const MOB_EG: [i32; 7] = [0, 0, 4, 5, 4, 2, 0];

// Passed pawns, by how far they've come (their own side's rank, 0–7).
const PASSED_MG: [i32; 8] = [0, 4, 6, 12, 22, 38, 60, 0];
const PASSED_EG: [i32; 8] = [0, 10, 16, 28, 48, 80, 130, 0];

const TEMPO: i32 = 10;

pub fn evaluate(b: &Board) -> i32 {
    let mut mg = [0i32; 2];
    let mut eg = [0i32; 2];
    let mut phase = 0;
    let mut pawns = [[0u32; 8]; 2]; // per side and file, a bit per rank holding a pawn
    let mut bishops = [0; 2];
    let mut pieces = [0; 2]; // non-pawn material, for spotting dead-drawn endings
    let mut rooks = [[0i32; 8]; 2]; // per side and file

    for rank in 0..8 {
        for file in 0..8 {
            let sq = rank * 16 + file;
            let p = b.sq[sq];
            if p == 0 {
                continue;
            }
            let (c, k) = ((p >> 3) as usize, kind(p) as usize);
            let idx = if c == 0 { (7 - rank) * 8 + file } else { rank * 8 + file };
            mg[c] += VALUE_MG[k] + PST_MG[k][idx];
            eg[c] += VALUE_EG[k] + PST_EG[k][idx];
            phase += PHASE[k];
            match k as u8 {
                PAWN => pawns[c][file] |= 1 << rank,
                KNIGHT | BISHOP | ROOK | QUEEN => {
                    pieces[c] += VALUE_MG[k];
                    if k as u8 == BISHOP {
                        bishops[c] += 1;
                    }
                    if k as u8 == ROOK {
                        rooks[c][file] += 1;
                    }
                    let n = mobility(b, sq as i32, k as u8, color(p)) - MOB_BASE[k];
                    mg[c] += n * MOB_MG[k];
                    eg[c] += n * MOB_EG[k];
                }
                _ => {}
            }
        }
    }

    for c in 0..2 {
        let them = 1 - c;
        if bishops[c] >= 2 {
            mg[c] += 30;
            eg[c] += 45;
        }
        for file in 0..8 {
            let mine = pawns[c][file];
            if mine == 0 {
                continue;
            }
            let count = mine.count_ones() as i32;
            if count > 1 {
                mg[c] -= 12 * (count - 1);
                eg[c] -= 18 * (count - 1);
            }
            let left = if file > 0 { pawns[c][file - 1] } else { 0 };
            let right = if file < 7 { pawns[c][file + 1] } else { 0 };
            if left | right == 0 {
                mg[c] -= 10 * count;
                eg[c] -= 14 * count;
            }
            // Passed: no enemy pawn ahead of it on its own or a neighboring file.
            let lo = file.saturating_sub(1);
            let hi = (file + 1).min(7);
            let blockers = (lo..=hi).fold(0, |m, f| m | pawns[them][f]);
            for rank in 0..8 {
                if mine & (1 << rank) == 0 {
                    continue;
                }
                let ahead = if c == 0 { 0xff & !((2u32 << rank) - 1) } else { (1u32 << rank) - 1 };
                if blockers & ahead == 0 {
                    let r = if c == 0 { rank } else { 7 - rank };
                    mg[c] += PASSED_MG[r];
                    eg[c] += PASSED_EG[r];
                }
            }
        }
        for file in 0..8 {
            if rooks[c][file] > 0 && pawns[c][file] == 0 {
                let bonus = rooks[c][file] * if pawns[them][file] == 0 { 20 } else { 8 };
                mg[c] += bonus;
                eg[c] += bonus / 2;
            }
        }
        // King shelter: own pawns just in front of a king on its back two ranks.
        let k = b.king[c] as usize;
        let (kr, kf) = (k >> 4, k & 7);
        let home = if c == 0 { kr <= 1 } else { kr >= 6 };
        if home {
            for f in kf.saturating_sub(1)..=(kf + 1).min(7) {
                let near = if c == 0 { 0b110 << kr } else { (0b011 << kr) >> 2 };
                if pawns[c][f] & near != 0 {
                    mg[c] += 12;
                } else {
                    mg[c] -= 10;
                }
            }
        }
    }

    let phase = phase.min(FULL_PHASE);
    let mut score = ((mg[0] - mg[1]) * phase + (eg[0] - eg[1]) * (FULL_PHASE - phase)) / FULL_PHASE;

    // Without pawns, being up less than a rook rarely wins: scale the edge way down, and to
    // nothing when neither side has mating material.
    let no_pawns = |c: usize| pawns[c].iter().all(|&f| f == 0);
    let minor = VALUE_MG[BISHOP as usize];
    if no_pawns(0) && no_pawns(1) && pieces[0] <= minor && pieces[1] <= minor {
        return 0;
    }
    let strong = if score > 0 { 0 } else { 1 };
    if no_pawns(strong) && pieces[strong] - pieces[1 - strong] < 400 {
        score /= if pieces[strong] <= minor { 16 } else { 4 };
    }

    (if b.side == WHITE { score } else { -score }) + TEMPO
}

fn mobility(b: &Board, from: i32, k: u8, us: u8) -> i32 {
    let mut n = 0;
    let open = |t: i32| t & 0x88 == 0 && (b.sq[t as usize] == 0 || color(b.sq[t as usize]) != us);
    if k == KNIGHT {
        return KNIGHT_DIRS.iter().filter(|&&d| open(from + d)).count() as i32;
    }
    let mut ray = |dirs: &[i32]| {
        for d in dirs {
            let mut t = from + d;
            while t & 0x88 == 0 {
                if b.sq[t as usize] != 0 {
                    if color(b.sq[t as usize]) != us {
                        n += 1;
                    }
                    break;
                }
                n += 1;
                t += d;
            }
        }
    };
    if k != ROOK {
        ray(&BISHOP_DIRS);
    }
    if k != BISHOP {
        ray(&ROOK_DIRS);
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eval(fen: &str) -> i32 {
        evaluate(&Board::from_fen(fen).unwrap())
    }

    #[test]
    fn symmetric() {
        // The same position with colors swapped and the board flipped scores the same for the
        // side to move.
        let a = eval("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
        let b = eval("rnbqk2r/pppp1ppp/5n2/2b1p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R b KQkq - 4 4");
        assert_eq!(a, b);
    }

    #[test]
    fn material_and_structure() {
        assert!(eval("4k3/8/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1") > 3000);
        // A passed pawn on the seventh beats one at home.
        assert!(eval("4k3/P7/8/8/8/8/8/4K3 w - - 0 1") > eval("4k3/8/8/8/8/8/P7/4K3 w - - 0 1") + 100);
        // Doubled, isolated pawns are worse than a healthy pair.
        assert!(eval("4k3/8/8/8/8/3P4/3P4/4K3 w - - 0 1") < eval("4k3/8/8/8/8/8/3PP3/4K3 w - - 0 1"));
        // A lone knight can't win; a rook against a bishop rarely does.
        assert_eq!(eval("4k3/8/8/8/8/8/8/3NK3 w - - 0 1"), 0);
        assert!(eval("4k3/8/8/2b5/8/8/8/3RK3 w - - 0 1") < 80);
    }
}
