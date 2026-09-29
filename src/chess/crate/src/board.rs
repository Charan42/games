//! The board, move generation and the rules of the game.
//!
//! Squares are 0x88: rank * 16 + file, so a1 = 0 and h8 = 0x77. Stepping off the board in any
//! direction lands on a square with a bit of 0x88 set, which makes "is this on the board" one
//! AND. Pieces are a kind (1–6) plus 8 for black.

pub const PAWN: u8 = 1;
pub const KNIGHT: u8 = 2;
pub const BISHOP: u8 = 3;
pub const ROOK: u8 = 4;
pub const QUEEN: u8 = 5;
pub const KING: u8 = 6;
pub const WHITE: u8 = 0;
pub const BLACK: u8 = 8;
pub const NO_SQ: u8 = 0x88;

pub fn kind(p: u8) -> u8 {
    p & 7
}
pub fn color(p: u8) -> u8 {
    p & 8
}
fn on_board(sq: i32) -> bool {
    sq & 0x88 == 0
}

/// A move: from and to squares (7 bits each), the promotion piece's kind, and flags.
pub type Move = u32;
pub const CAPTURE: u32 = 1 << 17;
pub const EN_PASSANT: u32 = 1 << 18;
pub const CASTLE: u32 = 1 << 19;
pub const DOUBLE_PUSH: u32 = 1 << 20;

pub fn from(m: Move) -> usize {
    (m & 0x7f) as usize
}
pub fn to(m: Move) -> usize {
    ((m >> 7) & 0x7f) as usize
}
pub fn promo(m: Move) -> u8 {
    ((m >> 14) & 7) as u8
}
fn mv(from: i32, to: i32, flags: u32) -> Move {
    from as u32 | (to as u32) << 7 | flags
}

pub const KNIGHT_DIRS: [i32; 8] = [33, 31, 18, 14, -33, -31, -18, -14];
pub const KING_DIRS: [i32; 8] = [1, -1, 16, -16, 17, 15, -17, -15];
pub const BISHOP_DIRS: [i32; 4] = [17, 15, -17, -15];
pub const ROOK_DIRS: [i32; 4] = [16, -16, 1, -1];

// Castling rights: 1 white king side, 2 white queen side, 4 black king side, 8 black queen side.
// A move from or to one of these squares (a king or rook leaving, a rook being taken) loses them.
const CASTLE_MASK: [u8; 128] = {
    let mut m = [15u8; 128];
    m[0x00] = 15 & !2;
    m[0x07] = 15 & !1;
    m[0x04] = 15 & !3;
    m[0x70] = 15 & !8;
    m[0x77] = 15 & !4;
    m[0x74] = 15 & !12;
    m
};

// Zobrist keys: a random number per (piece, square), side, castling rights and en-passant file.
// A position's hash is the XOR of its keys, updated move by move.
pub struct Zobrist {
    pub piece: [[u64; 128]; 16],
    pub side: u64,
    pub castle: [u64; 16],
    pub ep: [u64; 8],
}

const fn splitmix(state: u64) -> (u64, u64) {
    let next = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = next;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    (z ^ (z >> 31), next)
}

pub static Z: Zobrist = {
    let mut z = Zobrist { piece: [[0; 128]; 16], side: 0, castle: [0; 16], ep: [0; 8] };
    let mut s = 0x00c0_ffee_5eed_u64;
    let mut p = 0;
    while p < 16 {
        let mut q = 0;
        while q < 128 {
            let (v, n) = splitmix(s);
            z.piece[p][q] = v;
            s = n;
            q += 1;
        }
        p += 1;
    }
    let (v, n) = splitmix(s);
    z.side = v;
    s = n;
    let mut i = 0;
    while i < 16 {
        let (v, n) = splitmix(s);
        z.castle[i] = v;
        s = n;
        i += 1;
    }
    i = 0;
    while i < 8 {
        let (v, n) = splitmix(s);
        z.ep[i] = v;
        s = n;
        i += 1;
    }
    z
};

pub struct MoveList {
    pub moves: [Move; 256], // the most moves any legal position has is 218
    pub len: usize,
}

impl MoveList {
    pub fn new() -> Self {
        MoveList { moves: [0; 256], len: 0 }
    }
    fn push(&mut self, m: Move) {
        self.moves[self.len] = m;
        self.len += 1;
    }
    pub fn as_slice(&self) -> &[Move] {
        &self.moves[..self.len]
    }
}

// What a move destroys, so it can be taken back.
#[derive(Clone, Copy)]
struct Undo {
    mv: Move,
    captured: u8,
    castle: u8,
    ep: u8,
    halfmove: u32,
    hash: u64, // before the move: also the list of earlier positions, for repetitions
}

/// Why the game is over, if it is.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Playing = 0,
    Checkmate = 1,
    Stalemate = 2,
    FiftyMoves = 3,
    Repetition = 4,
    NoMaterial = 5,
}

#[derive(Clone)]
pub struct Board {
    pub sq: [u8; 128],
    pub side: u8,
    pub castle: u8,
    pub ep: u8, // the square a pawn skipped over last move, or NO_SQ
    pub halfmove: u32, // moves since the last capture or pawn move
    pub fullmove: u32,
    pub king: [u8; 2], // by side >> 3
    pub hash: u64,
    history: Vec<Undo>,
}

pub const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

impl Default for Board {
    fn default() -> Self {
        Board::from_fen(START).unwrap()
    }
}

impl Board {
    pub fn from_fen(fen: &str) -> Option<Board> {
        let mut b = Board {
            sq: [0; 128],
            side: WHITE,
            castle: 0,
            ep: NO_SQ,
            halfmove: 0,
            fullmove: 1,
            king: [NO_SQ; 2],
            hash: 0,
            history: Vec::with_capacity(512),
        };
        let mut parts = fen.split_whitespace();
        let (mut rank, mut file) = (7i32, 0i32);
        for c in parts.next()?.chars() {
            match c {
                '/' => (rank, file) = (rank - 1, 0),
                '1'..='8' => file += c as i32 - '0' as i32,
                _ => {
                    let k = match c.to_ascii_lowercase() {
                        'p' => PAWN,
                        'n' => KNIGHT,
                        'b' => BISHOP,
                        'r' => ROOK,
                        'q' => QUEEN,
                        'k' => KING,
                        _ => return None,
                    };
                    if !(0..8).contains(&rank) || !(0..8).contains(&file) {
                        return None;
                    }
                    let sq = (rank * 16 + file) as usize;
                    let p = k | if c.is_ascii_lowercase() { BLACK } else { WHITE };
                    if k == KING {
                        if b.king[(p >> 3) as usize] != NO_SQ {
                            return None;
                        }
                        b.king[(p >> 3) as usize] = sq as u8;
                    }
                    b.sq[sq] = p;
                    file += 1;
                }
            }
        }
        if b.king.contains(&NO_SQ) {
            return None;
        }
        b.side = match parts.next().unwrap_or("w") {
            "w" => WHITE,
            "b" => BLACK,
            _ => return None,
        };
        for c in parts.next().unwrap_or("-").chars() {
            b.castle |= match c {
                'K' => 1,
                'Q' => 2,
                'k' => 4,
                'q' => 8,
                _ => 0,
            };
        }
        // Drop rights the pieces don't back up, so a bad FEN can't castle a missing rook.
        let has = |sq: usize, p: u8| b.sq[sq] == p;
        if !(has(0x04, KING) && has(0x07, ROOK)) {
            b.castle &= !1;
        }
        if !(has(0x04, KING) && has(0x00, ROOK)) {
            b.castle &= !2;
        }
        if !(has(0x74, KING | BLACK) && has(0x77, ROOK | BLACK)) {
            b.castle &= !4;
        }
        if !(has(0x74, KING | BLACK) && has(0x70, ROOK | BLACK)) {
            b.castle &= !8;
        }
        let ep = parts.next().unwrap_or("-").as_bytes();
        if ep.len() == 2 && (b'a'..=b'h').contains(&ep[0]) && (ep[1] == b'3' || ep[1] == b'6') {
            b.ep = (ep[1] - b'1') * 16 + (ep[0] - b'a');
        }
        b.halfmove = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        b.fullmove = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1).max(1);
        b.hash = b.compute_hash();
        Some(b)
    }

    pub fn compute_hash(&self) -> u64 {
        let mut h = 0;
        for sq in 0..128 {
            if self.sq[sq] != 0 {
                h ^= Z.piece[self.sq[sq] as usize][sq];
            }
        }
        if self.side == BLACK {
            h ^= Z.side;
        }
        h ^ Z.castle[self.castle as usize] ^ self.ep_key()
    }

    // The en-passant square only counts toward the hash when a pawn can actually take there, so
    // positions that differ only by an unusable en-passant square repeat, as the rules say.
    fn ep_key(&self) -> u64 {
        if self.ep == NO_SQ {
            return 0;
        }
        let ep = self.ep as i32;
        let (pawn, a, b) = if self.side == WHITE { (PAWN, ep - 15, ep - 17) } else { (PAWN | BLACK, ep + 15, ep + 17) };
        if (on_board(a) && self.sq[a as usize] == pawn) || (on_board(b) && self.sq[b as usize] == pawn) {
            Z.ep[(ep & 7) as usize]
        } else {
            0
        }
    }

    /// Whether any piece of color `by` attacks `sq`.
    pub fn attacked(&self, sq: usize, by: u8) -> bool {
        let s = sq as i32;
        let pawn = PAWN | by;
        let pawn_from = if by == WHITE { [s - 15, s - 17] } else { [s + 15, s + 17] };
        for t in pawn_from {
            if on_board(t) && self.sq[t as usize] == pawn {
                return true;
            }
        }
        for (dirs, piece) in [(&KNIGHT_DIRS, KNIGHT), (&KING_DIRS, KING)] {
            for d in dirs {
                let t = s + d;
                if on_board(t) && self.sq[t as usize] == piece | by {
                    return true;
                }
            }
        }
        for (dirs, slider) in [(&BISHOP_DIRS, BISHOP), (&ROOK_DIRS, ROOK)] {
            for d in dirs {
                let mut t = s + d;
                while on_board(t) {
                    let p = self.sq[t as usize];
                    if p != 0 {
                        if p == slider | by || p == QUEEN | by {
                            return true;
                        }
                        break;
                    }
                    t += d;
                }
            }
        }
        false
    }

    pub fn in_check(&self) -> bool {
        self.attacked(self.king[(self.side >> 3) as usize] as usize, self.side ^ BLACK)
    }

    /// Pseudo-legal moves (they may leave the king in check; `make` rejects those). With
    /// `tactical`, only captures and queen promotions, for the quiescence search.
    pub fn generate(&self, list: &mut MoveList, tactical: bool) {
        let us = self.side;
        for rank in 0..8 {
            for file in 0..8 {
                let from = rank * 16 + file;
                let p = self.sq[from as usize];
                if p == 0 || color(p) != us {
                    continue;
                }
                match kind(p) {
                    PAWN => self.pawn_moves(from, list, tactical),
                    KNIGHT => self.steps(from, &KNIGHT_DIRS, list, tactical),
                    BISHOP => self.slides(from, &BISHOP_DIRS, list, tactical),
                    ROOK => self.slides(from, &ROOK_DIRS, list, tactical),
                    QUEEN => {
                        self.slides(from, &BISHOP_DIRS, list, tactical);
                        self.slides(from, &ROOK_DIRS, list, tactical);
                    }
                    _ => {
                        self.steps(from, &KING_DIRS, list, tactical);
                        if !tactical {
                            self.castles(list);
                        }
                    }
                }
            }
        }
    }

    fn steps(&self, from: i32, dirs: &[i32], list: &mut MoveList, tactical: bool) {
        for d in dirs {
            let t = from + d;
            if !on_board(t) {
                continue;
            }
            let p = self.sq[t as usize];
            if p == 0 {
                if !tactical {
                    list.push(mv(from, t, 0));
                }
            } else if color(p) != self.side {
                list.push(mv(from, t, CAPTURE));
            }
        }
    }

    fn slides(&self, from: i32, dirs: &[i32], list: &mut MoveList, tactical: bool) {
        for d in dirs {
            let mut t = from + d;
            while on_board(t) {
                let p = self.sq[t as usize];
                if p == 0 {
                    if !tactical {
                        list.push(mv(from, t, 0));
                    }
                } else {
                    if color(p) != self.side {
                        list.push(mv(from, t, CAPTURE));
                    }
                    break;
                }
                t += d;
            }
        }
    }

    fn pawn_moves(&self, from: i32, list: &mut MoveList, tactical: bool) {
        let (dir, start, last) = if self.side == WHITE { (16, 1, 7) } else { (-16, 6, 0) };
        let promote = |list: &mut MoveList, t: i32, flags: u32| {
            for k in [QUEEN, KNIGHT, ROOK, BISHOP] {
                if !tactical || k == QUEEN {
                    list.push(mv(from, t, flags | (k as u32) << 14));
                }
            }
        };
        let one = from + dir;
        if on_board(one) && self.sq[one as usize] == 0 {
            if one >> 4 == last {
                promote(list, one, 0);
            } else if !tactical {
                list.push(mv(from, one, 0));
                let two = one + dir;
                if from >> 4 == start && self.sq[two as usize] == 0 {
                    list.push(mv(from, two, DOUBLE_PUSH));
                }
            }
        }
        for t in [one - 1, one + 1] {
            if !on_board(t) {
                continue;
            }
            let p = self.sq[t as usize];
            if p != 0 && color(p) != self.side {
                if t >> 4 == last {
                    promote(list, t, CAPTURE);
                } else {
                    list.push(mv(from, t, CAPTURE));
                }
            } else if p == 0 && t == self.ep as i32 {
                list.push(mv(from, t, CAPTURE | EN_PASSANT));
            }
        }
    }

    fn castles(&self, list: &mut MoveList) {
        let (rights, base, them) = if self.side == WHITE { (self.castle & 3, 0x00, BLACK) } else { (self.castle >> 2 & 3, 0x70, WHITE) };
        if rights == 0 || self.attacked(base + 4, them) {
            return;
        }
        let empty = |files: &[usize]| files.iter().all(|f| self.sq[base + f] == 0);
        let safe = |files: &[usize]| files.iter().all(|f| !self.attacked(base + f, them));
        if rights & 1 != 0 && empty(&[5, 6]) && safe(&[5, 6]) {
            list.push(mv(base as i32 + 4, base as i32 + 6, CASTLE));
        }
        if rights & 2 != 0 && empty(&[1, 2, 3]) && safe(&[2, 3]) {
            list.push(mv(base as i32 + 4, base as i32 + 2, CASTLE));
        }
    }

    /// Plays a pseudo-legal move. Returns false, and changes nothing, if it leaves the mover's
    /// king in check.
    pub fn make(&mut self, m: Move) -> bool {
        let (from, to) = (from(m), to(m));
        let us = self.side;
        let piece = self.sq[from];
        let cap_sq = if m & EN_PASSANT == 0 { to } else if us == WHITE { to - 16 } else { to + 16 };
        let captured = self.sq[cap_sq];
        self.history.push(Undo { mv: m, captured, castle: self.castle, ep: self.ep, halfmove: self.halfmove, hash: self.hash });

        let mut h = self.hash ^ self.ep_key() ^ Z.castle[self.castle as usize] ^ Z.side;
        if captured != 0 {
            self.sq[cap_sq] = 0;
            h ^= Z.piece[captured as usize][cap_sq];
        }
        self.sq[from] = 0;
        let placed = if promo(m) != 0 { promo(m) | us } else { piece };
        self.sq[to] = placed;
        h ^= Z.piece[piece as usize][from] ^ Z.piece[placed as usize][to];
        if m & CASTLE != 0 {
            let (rf, rt) = if to > from { (from + 3, from + 1) } else { (from - 4, from - 1) };
            let rook = self.sq[rf];
            self.sq[rf] = 0;
            self.sq[rt] = rook;
            h ^= Z.piece[rook as usize][rf] ^ Z.piece[rook as usize][rt];
        }
        if kind(piece) == KING {
            self.king[(us >> 3) as usize] = to as u8;
        }
        self.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
        h ^= Z.castle[self.castle as usize];
        self.halfmove = if kind(piece) == PAWN || captured != 0 { 0 } else { self.halfmove + 1 };
        if us == BLACK {
            self.fullmove += 1;
        }
        self.side ^= BLACK;
        self.ep = if m & DOUBLE_PUSH != 0 { ((from + to) / 2) as u8 } else { NO_SQ };
        self.hash = h ^ self.ep_key();

        if self.attacked(self.king[(us >> 3) as usize] as usize, self.side) {
            self.unmake();
            return false;
        }
        true
    }

    /// Takes back the last move.
    pub fn unmake(&mut self) {
        let u = self.history.pop().expect("a move to take back");
        let (m, from, to) = (u.mv, from(u.mv), to(u.mv));
        self.side ^= BLACK;
        let us = self.side;
        if us == BLACK {
            self.fullmove -= 1;
        }
        let piece = if promo(m) != 0 { PAWN | us } else { self.sq[to] };
        self.sq[from] = piece;
        self.sq[to] = 0;
        let cap_sq = if m & EN_PASSANT == 0 { to } else if us == WHITE { to - 16 } else { to + 16 };
        self.sq[cap_sq] = u.captured;
        if m & CASTLE != 0 {
            let (rf, rt) = if to > from { (from + 3, from + 1) } else { (from - 4, from - 1) };
            self.sq[rf] = self.sq[rt];
            self.sq[rt] = 0;
        }
        if kind(piece) == KING {
            self.king[(us >> 3) as usize] = from as u8;
        }
        self.castle = u.castle;
        self.ep = u.ep;
        self.halfmove = u.halfmove;
        self.hash = u.hash;
    }

    /// Passes the turn, for null-move pruning. The move counter restarts, so repetition
    /// checks never look back past it.
    pub fn make_null(&mut self) {
        self.history.push(Undo { mv: 0, captured: 0, castle: self.castle, ep: self.ep, halfmove: self.halfmove, hash: self.hash });
        self.hash ^= self.ep_key() ^ Z.side;
        self.ep = NO_SQ;
        self.side ^= BLACK;
        self.halfmove = 0;
    }

    pub fn unmake_null(&mut self) {
        let u = self.history.pop().expect("a null move to take back");
        self.side ^= BLACK;
        self.ep = u.ep;
        self.halfmove = u.halfmove;
        self.hash = u.hash;
    }

    pub fn moves_played(&self) -> usize {
        self.history.len()
    }

    pub fn legal(&mut self, out: &mut MoveList) {
        let mut pseudo = MoveList::new();
        self.generate(&mut pseudo, false);
        for &m in pseudo.as_slice() {
            if self.make(m) {
                self.unmake();
                out.push(m);
            }
        }
    }

    /// How many earlier positions in the game are this one, with the same player to move.
    /// Only positions since the last capture or pawn move can match.
    pub fn repetitions(&self) -> usize {
        let n = self.history.len();
        let limit = (self.halfmove as usize).min(n);
        (2..=limit).step_by(2).filter(|&i| self.history[n - i].hash == self.hash).count()
    }

    /// Neither side can possibly mate: bare kings, a single minor piece, or only bishops that
    /// all stand on squares of one color.
    pub fn insufficient(&self) -> bool {
        let (mut knights, mut bishops) = (0, [0; 2]);
        for sq in 0..128 {
            match kind(self.sq[sq]) {
                PAWN | ROOK | QUEEN => return false,
                KNIGHT => knights += 1,
                BISHOP => bishops[((sq >> 4) + sq) & 1] += 1,
                _ => {}
            }
        }
        let minors = knights + bishops[0] + bishops[1];
        minors <= 1 || (knights == 0 && (bishops[0] == 0 || bishops[1] == 0))
    }

    pub fn status(&mut self) -> Status {
        let mut list = MoveList::new();
        self.legal(&mut list);
        if list.len == 0 {
            return if self.in_check() { Status::Checkmate } else { Status::Stalemate };
        }
        if self.halfmove >= 100 {
            Status::FiftyMoves
        } else if self.repetitions() >= 2 {
            Status::Repetition
        } else if self.insufficient() {
            Status::NoMaterial
        } else {
            Status::Playing
        }
    }

    #[cfg(test)]
    pub fn perft(&mut self, depth: u32) -> u64 {
        if depth == 0 {
            return 1;
        }
        let mut list = MoveList::new();
        self.generate(&mut list, false);
        let mut n = 0;
        for &m in list.as_slice() {
            if self.make(m) {
                n += self.perft(depth - 1);
                self.unmake();
            }
        }
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perft(fen: &str, counts: &[u64]) {
        let mut b = Board::from_fen(fen).unwrap();
        for (depth, &n) in counts.iter().enumerate() {
            assert_eq!(b.perft(depth as u32 + 1), n, "{fen} at depth {}", depth + 1);
        }
    }

    // Node counts from the Chess Programming Wiki's perft results: every legal move to the
    // given depth, which catches almost any move-generation bug.
    #[test]
    fn perft_start() {
        perft(START, &[20, 400, 8902, 197_281]);
    }

    #[test]
    fn perft_kiwipete() {
        perft("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", &[48, 2039, 97_862]);
    }

    #[test]
    fn perft_endgame_en_passant_and_pins() {
        perft("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", &[14, 191, 2812, 43_238]);
    }

    #[test]
    fn perft_promotions_and_castling_through_check() {
        perft("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", &[6, 264, 9467]);
        perft("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", &[44, 1486, 62_379]);
    }

    #[test]
    fn unmake_restores_everything_and_the_hash_stays_in_step() {
        let mut b = Board::from_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1").unwrap();
        let (sq, hash) = (b.sq, b.hash);
        let mut seed = 7u64;
        let mut played = 0;
        for _ in 0..200 {
            let mut list = MoveList::new();
            b.legal(&mut list);
            if list.len == 0 {
                break;
            }
            let (r, n) = splitmix(seed);
            seed = n;
            assert!(b.make(list.moves[(r % list.len as u64) as usize]));
            assert_eq!(b.hash, b.compute_hash());
            played += 1;
        }
        for _ in 0..played {
            b.unmake();
        }
        assert_eq!((b.sq, b.hash), (sq, hash));
    }

    #[test]
    fn game_endings() {
        // Fool's mate.
        let mut b = Board::from_fen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3").unwrap();
        assert_eq!(b.status(), Status::Checkmate);
        let mut b = Board::from_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").unwrap();
        assert_eq!(b.status(), Status::Stalemate);
        let mut b = Board::from_fen("8/8/4k3/8/8/2B5/4K3/8 w - - 0 1").unwrap();
        assert_eq!(b.status(), Status::NoMaterial);
        let mut b = Board::from_fen("8/8/4k3/8/8/2B5/4K3/7r w - - 0 1").unwrap();
        assert_eq!(b.status(), Status::Playing);
        let mut b = Board::from_fen("8/8/4k3/8/8/2B5/4K3/6r1 w - - 100 80").unwrap();
        assert_eq!(b.status(), Status::FiftyMoves);
    }

    #[test]
    fn threefold_repetition() {
        let mut b = Board::default();
        let find = |b: &mut Board, uci: &str| {
            let mut list = MoveList::new();
            b.legal(&mut list);
            let sq = |s: &[u8]| ((s[1] - b'1') * 16 + (s[0] - b'a')) as usize;
            let u = uci.as_bytes();
            *list.as_slice().iter().find(|&&m| from(m) == sq(&u[0..2]) && to(m) == sq(&u[2..4])).unwrap()
        };
        for _ in 0..2 {
            for uci in ["g1f3", "g8f6", "f3g1", "f6g8"] {
                let m = find(&mut b, uci);
                b.make(m);
            }
        }
        assert_eq!(b.status(), Status::Repetition);
    }
}
