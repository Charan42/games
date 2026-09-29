//! Chess engine for src/chess, compiled to WebAssembly.
//!
//! The page keeps one instance for the rules (which moves are legal, is it mate) and a second
//! one in a Web Worker that searches, so thinking never freezes the board. Only numbers cross
//! the boundary: squares are 0–63 with a1 = 0, and a move is from | to << 6 | promotion << 12,
//! where the promotion is a piece kind (2 knight, 3 bishop, 4 rook, 5 queen).

mod board;
mod eval;
mod search;

use board::{Board, Move, MoveList};
use search::Search;
use std::cell::RefCell;

#[derive(Default)]
struct Engine {
    board: Board,
    legal: Vec<Move>,
    search: Option<Search>, // 4 MB of hash table, only in the instance that thinks
    fen: Vec<u8>,
}

thread_local! {
    static ENGINE: RefCell<Engine> = RefCell::new(Engine { fen: vec![0; 128], ..Default::default() });
}

fn sq64(sq: usize) -> u32 {
    ((sq >> 4) * 8 + (sq & 7)) as u32
}
fn sq88(sq: u32) -> usize {
    ((sq >> 3) * 16 + (sq & 7)) as usize
}
fn external(m: Move) -> u32 {
    sq64(board::from(m)) | sq64(board::to(m)) << 6 | (board::promo(m) as u32) << 12
}

impl Engine {
    fn refresh(&mut self) {
        let mut list = MoveList::new();
        self.board.legal(&mut list);
        self.legal = list.as_slice().to_vec();
    }
}

/// Starts a new game from the initial position.
#[unsafe(no_mangle)]
pub extern "C" fn reset() {
    ENGINE.with_borrow_mut(|e| {
        e.board = Board::default();
        e.refresh();
    });
}

/// Address of a 128-byte buffer: write a FEN there, then call `load(length)`.
#[unsafe(no_mangle)]
pub extern "C" fn fen_buffer() -> *mut u8 {
    ENGINE.with_borrow_mut(|e| e.fen.as_mut_ptr())
}

/// Sets up the position in the FEN buffer. Returns 1, or 0 (and changes nothing) if it isn't valid.
#[unsafe(no_mangle)]
pub extern "C" fn load(len: u32) -> u32 {
    ENGINE.with_borrow_mut(|e| {
        let text = std::str::from_utf8(&e.fen[..(len as usize).min(128)]).ok().and_then(Board::from_fen);
        match text {
            Some(b) => {
                e.board = b;
                e.refresh();
                1
            }
            None => 0,
        }
    })
}

/// The piece on a square: 0 empty, 1–6 white pawn to king, 9–14 black.
#[unsafe(no_mangle)]
pub extern "C" fn piece(sq: u32) -> u32 {
    ENGINE.with_borrow(|e| e.board.sq[sq88(sq & 63)] as u32)
}

/// 0 when White is to move, 1 for Black.
#[unsafe(no_mangle)]
pub extern "C" fn side() -> u32 {
    ENGINE.with_borrow(|e| (e.board.side >> 3) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn in_check() -> u32 {
    ENGINE.with_borrow(|e| e.board.in_check() as u32)
}

/// 0 playing, 1 checkmate, 2 stalemate, 3 fifty-move rule, 4 threefold repetition,
/// 5 not enough material to mate.
#[unsafe(no_mangle)]
pub extern "C" fn status() -> u32 {
    ENGINE.with_borrow_mut(|e| e.board.status() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn legal_count() -> u32 {
    ENGINE.with_borrow(|e| e.legal.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn legal_move(i: u32) -> u32 {
    ENGINE.with_borrow(|e| e.legal.get(i as usize).map_or(0, |&m| external(m)))
}

/// Plays a move. Returns 1, or 0 if it isn't legal here.
#[unsafe(no_mangle)]
pub extern "C" fn play(m: u32) -> u32 {
    ENGINE.with_borrow_mut(|e| match e.legal.iter().find(|&&l| external(l) == m) {
        Some(&l) => {
            e.board.make(l);
            e.refresh();
            1
        }
        None => 0,
    })
}

/// Takes back the last move. Returns 0 if there wasn't one.
#[unsafe(no_mangle)]
pub extern "C" fn undo() -> u32 {
    ENGINE.with_borrow_mut(|e| {
        if e.board.moves_played() == 0 {
            return 0;
        }
        e.board.unmake();
        e.refresh();
        1
    })
}

/// Searches for up to `ms` milliseconds or `depth` plies and returns the best move, or 0 if
/// the game is over. `noise` (centipawns) and `seed` make weaker levels vary their play.
#[unsafe(no_mangle)]
pub extern "C" fn think(ms: f64, depth: u32, noise: i32, seed: u32) -> u32 {
    ENGINE.with_borrow_mut(|e| {
        let search = e.search.get_or_insert_with(Search::default);
        search.think(&mut e.board, ms, depth, noise, seed).map_or(0, external)
    })
}

/// About the last search: how deep it got, its score in centipawns for the side that moved
/// (mate is ±30000 minus the plies to it), and how many positions it looked at.
#[unsafe(no_mangle)]
pub extern "C" fn last_depth() -> u32 {
    ENGINE.with_borrow(|e| e.search.as_ref().map_or(0, |s| s.depth))
}
#[unsafe(no_mangle)]
pub extern "C" fn last_score() -> i32 {
    ENGINE.with_borrow(|e| e.search.as_ref().map_or(0, |s| s.score))
}
#[unsafe(no_mangle)]
pub extern "C" fn last_nodes() -> f64 {
    ENGINE.with_borrow(|e| e.search.as_ref().map_or(0.0, |s| s.nodes as f64))
}
