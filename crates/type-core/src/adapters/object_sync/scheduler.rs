//! When to sync.
//!
//! The shells own the *triggers* — a note was written, the app came to the
//! foreground, the user tapped sync — because those are platform-specific. This
//! owns the *policy*: coalesce bursts, keep a floor between rounds, back off
//! after failures, never run two rounds at once, and poll slowly so remote
//! edits are noticed without anything pushing to us.
//!
//! The policy is a pure function ([`next_step`]) so it can be tested without
//! threads or clocks; the worker below is a thin loop around it.

use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;

use crate::domain::object_sync::SyncOutcome;
use crate::AppEnv;

/// Wait for the burst to settle before acting on a change.
pub const DEBOUNCE_MS: i64 = 3_000;
/// Floor between the starts of two rounds, so a busy editor cannot spin sync.
pub const MIN_ROUND_GAP_MS: i64 = 10_000;
/// Idle poll. Nothing pushes to us, so this is how a device notices edits made
/// elsewhere while it just sits there.
pub const IDLE_POLL_MS: i64 = 120_000;
/// First retry delay after a failure; doubles up to the ceiling.
pub const BACKOFF_BASE_MS: i64 = 15_000;
pub const BACKOFF_MAX_MS: i64 = 300_000;

// ── Policy ─────────────────────────────────────────────────────────────────────

/// Scheduler bookkeeping. Pure data so [`next_step`] can be tested directly.
#[derive(Clone, Debug, Default)]
pub struct SchedulerState {
    /// A trigger fired and has not been served yet.
    pub dirty: bool,
    /// When the most recent trigger arrived.
    pub requested_ms: i64,
    /// When the last round started.
    pub last_round_ms: i64,
    pub consecutive_failures: u32,
    pub running: bool,
    pub last_error: Option<String>,
    pub last_outcome: Option<SyncOutcome>,
    pub last_synced_ms: Option<i64>,
}

impl SchedulerState {
    fn backoff_ms(&self) -> i64 {
        if self.consecutive_failures == 0 {
            return 0;
        }
        let shift = (self.consecutive_failures - 1).min(5);
        (BACKOFF_BASE_MS << shift).min(BACKOFF_MAX_MS)
    }
}

/// What the worker should do next.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Step {
    /// Start a round now.
    Run,
    /// Sleep this many milliseconds, then re-evaluate.
    Wait(i64),
}

/// Decide whether a round is due.
///
/// Ordering of the three delays matters: the debounce keeps a burst of edits
/// from each starting a round, the gap keeps steady typing from starving
/// everything else, and the backoff keeps a broken bucket from being hammered.
/// The longest one wins.
pub fn next_step(state: &SchedulerState, now_ms: i64) -> Step {
    if state.running {
        return Step::Wait(MIN_ROUND_GAP_MS);
    }

    let backoff_ready = state.last_round_ms + state.backoff_ms();
    let gap_ready = state.last_round_ms + MIN_ROUND_GAP_MS;

    let ready_at = if state.dirty {
        (state.requested_ms + DEBOUNCE_MS).max(gap_ready).max(backoff_ready)
    } else {
        // Nothing asked for a round, so the only reason to run is the idle
        // poll — and a failing bucket still backs off.
        (state.last_round_ms + IDLE_POLL_MS).max(backoff_ready)
    };

    if now_ms >= ready_at {
        Step::Run
    } else {
        Step::Wait(ready_at - now_ms)
    }
}

// ── Worker ─────────────────────────────────────────────────────────────────────

struct Scheduler {
    state: Mutex<SchedulerState>,
    wake: Condvar,
    env: Mutex<Option<AppEnv>>,
}

static SCHEDULER: OnceLock<Arc<Scheduler>> = OnceLock::new();

/// Runs one round for the active profile. Set once by the adapter hub so this
/// module stays free of settings and transport concerns.
type RoundFn = fn(&AppEnv) -> Result<SyncOutcome, String>;
static ROUND_FN: OnceLock<RoundFn> = OnceLock::new();

fn scheduler() -> &'static Arc<Scheduler> {
    SCHEDULER.get_or_init(|| {
        Arc::new(Scheduler {
            state: Mutex::new(SchedulerState::default()),
            wake: Condvar::new(),
            env: Mutex::new(None),
        })
    })
}

/// Install the round implementation and start the worker. Idempotent.
pub fn install(env: AppEnv, round: RoundFn) {
    let scheduler = scheduler();
    *scheduler.env.lock().unwrap() = Some(env);

    // `set` failing means the worker is already running with the same fn.
    if ROUND_FN.set(round).is_err() {
        return;
    }

    let handle = Arc::clone(scheduler);
    // std::thread, not tokio: the core has no async runtime on iOS/Android.
    std::thread::Builder::new()
        .name("type-object-sync".to_string())
        .spawn(move || worker_loop(handle))
        .ok();
}

/// Ask for a round. Returns immediately; the worker decides when.
pub fn request(reason: &str) {
    let scheduler = scheduler();
    let mut state = scheduler.state.lock().unwrap();
    state.dirty = true;
    state.requested_ms = crate::now_ms().unwrap_or(0);
    // An explicit request clears the backoff: the user asking is a signal that
    // whatever was broken may now be fixed.
    if !reason.is_empty() && reason != "auto" {
        state.consecutive_failures = 0;
    }
    drop(state);
    scheduler.wake.notify_all();
}

pub fn snapshot() -> SchedulerState {
    scheduler().state.lock().unwrap().clone()
}

/// Record the result of a round run outside the worker (a manual "Sync now"),
/// so the UI and the backoff see one consistent history.
pub fn record_round(started_ms: i64, result: &Result<SyncOutcome, String>) {
    let scheduler = scheduler();
    let mut state = scheduler.state.lock().unwrap();
    state.last_round_ms = started_ms;
    match result {
        Ok(outcome) => {
            state.consecutive_failures = 0;
            state.last_error = None;
            state.last_synced_ms = Some(started_ms);
            state.last_outcome = Some(outcome.clone());
        }
        Err(error) => {
            state.consecutive_failures = state.consecutive_failures.saturating_add(1);
            state.last_error = Some(error.clone());
        }
    }
}

fn worker_loop(scheduler: Arc<Scheduler>) {
    loop {
        let wait_ms = {
            let state = scheduler.state.lock().unwrap();
            match next_step(&state, crate::now_ms().unwrap_or(0)) {
                Step::Run => 0,
                Step::Wait(ms) => ms.max(1),
            }
        };

        if wait_ms > 0 {
            let state = scheduler.state.lock().unwrap();
            let _ = scheduler
                .wake
                .wait_timeout(state, Duration::from_millis(wait_ms as u64));
            continue;
        }

        let env = { scheduler.env.lock().unwrap().clone() };
        let Some(env) = env else {
            continue;
        };
        let Some(round) = ROUND_FN.get() else {
            continue;
        };

        let started_ms = crate::now_ms().unwrap_or(0);
        {
            let mut state = scheduler.state.lock().unwrap();
            state.running = true;
            state.dirty = false;
            state.last_round_ms = started_ms;
        }

        let result = round(&env);

        {
            let mut state = scheduler.state.lock().unwrap();
            state.running = false;
            match &result {
                Ok(outcome) => {
                    state.consecutive_failures = 0;
                    state.last_error = None;
                    state.last_synced_ms = Some(started_ms);
                    state.last_outcome = Some(outcome.clone());
                }
                Err(error) => {
                    state.consecutive_failures = state.consecutive_failures.saturating_add(1);
                    state.last_error = Some(error.clone());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idle_at(last_round_ms: i64) -> SchedulerState {
        SchedulerState {
            last_round_ms,
            ..SchedulerState::default()
        }
    }

    #[test]
    fn a_change_waits_out_the_debounce() {
        let state = SchedulerState {
            dirty: true,
            requested_ms: 1_000,
            last_round_ms: 0,
            ..SchedulerState::default()
        };
        // Too soon: the gap floor (10s) dominates the 3s debounce here.
        assert_eq!(next_step(&state, 2_000), Step::Wait(8_000));
        assert_eq!(next_step(&state, 10_000), Step::Run);
    }

    #[test]
    fn a_burst_of_edits_collapses_into_one_round() {
        let mut state = SchedulerState {
            dirty: true,
            requested_ms: 100_000,
            last_round_ms: 50_000,
            ..SchedulerState::default()
        };
        // Each keystroke pushes the request forward, so the round keeps
        // sliding rather than firing per edit.
        assert_eq!(next_step(&state, 101_000), Step::Wait(2_000));
        state.requested_ms = 102_000;
        assert_eq!(next_step(&state, 103_000), Step::Wait(2_000));
        state.requested_ms = 102_000;
        assert_eq!(next_step(&state, 105_000), Step::Run);
    }

    #[test]
    fn rounds_keep_a_minimum_gap_even_under_constant_edits() {
        let state = SchedulerState {
            dirty: true,
            requested_ms: 10_000,
            last_round_ms: 10_000,
            ..SchedulerState::default()
        };
        assert_eq!(next_step(&state, 13_000), Step::Wait(7_000));
        assert_eq!(next_step(&state, 20_000), Step::Run);
    }

    #[test]
    fn an_idle_scheduler_polls_slowly() {
        let state = idle_at(0);
        assert_eq!(next_step(&state, 1_000), Step::Wait(IDLE_POLL_MS - 1_000));
        assert_eq!(next_step(&state, IDLE_POLL_MS), Step::Run);
    }

    #[test]
    fn failures_back_off_exponentially_up_to_the_ceiling() {
        // Pending work, so the backoff is the binding constraint rather than
        // the idle poll.
        let mut state = SchedulerState {
            dirty: true,
            requested_ms: 0,
            last_round_ms: 0,
            ..SchedulerState::default()
        };

        state.consecutive_failures = 1;
        assert_eq!(next_step(&state, BACKOFF_BASE_MS - 1), Step::Wait(1));
        assert_eq!(next_step(&state, BACKOFF_BASE_MS), Step::Run);

        state.consecutive_failures = 2;
        assert_eq!(next_step(&state, BACKOFF_BASE_MS), Step::Wait(BACKOFF_BASE_MS));

        state.consecutive_failures = 99;
        assert_eq!(state.backoff_ms(), BACKOFF_MAX_MS);
        assert_eq!(next_step(&state, BACKOFF_MAX_MS), Step::Run);
    }

    #[test]
    fn an_idle_scheduler_waits_for_whichever_is_longer() {
        let mut state = idle_at(0);

        // A short backoff is absorbed by the idle poll…
        state.consecutive_failures = 1;
        assert_eq!(next_step(&state, 0), Step::Wait(IDLE_POLL_MS));

        // …but one longer than the poll pushes the next attempt out.
        state.consecutive_failures = 99;
        assert_eq!(next_step(&state, 0), Step::Wait(BACKOFF_MAX_MS));
    }

    #[test]
    fn backoff_applies_to_pending_changes_too() {
        let state = SchedulerState {
            dirty: true,
            requested_ms: 0,
            last_round_ms: 0,
            consecutive_failures: 3,
            ..SchedulerState::default()
        };
        // Not the 3s debounce — a bucket that is failing gets left alone.
        assert!(matches!(next_step(&state, 5_000), Step::Wait(ms) if ms > DEBOUNCE_MS));
    }

    #[test]
    fn a_running_round_is_never_joined_by_a_second() {
        let state = SchedulerState {
            dirty: true,
            running: true,
            requested_ms: 0,
            last_round_ms: 0,
            ..SchedulerState::default()
        };
        assert_eq!(next_step(&state, 1_000_000), Step::Wait(MIN_ROUND_GAP_MS));
    }
}
