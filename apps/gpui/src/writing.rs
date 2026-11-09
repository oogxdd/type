use super::*;

pub(crate) struct Session {
    note: SharedString,
    root: std::path::PathBuf,
    pub(crate) deadline: Instant,
    pub(crate) seconds: u64,
}

impl TypeApp {
    pub(crate) fn start_writing(
        &mut self,
        minutes: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.locked || self.busy || self.current_folder().is_some() {
            return;
        }
        let previous = self.active.clone();
        self.new_note(window, cx);
        if self.active == previous {
            return;
        }
        self.preview = false;
        self.preview_table = None;
        self.writing = Some(Session {
            note: self.active.clone(),
            root: self.backend.root.clone(),
            deadline: Instant::now() + Duration::from_secs(minutes * 60),
            seconds: minutes * 60,
        });
        self.error = None;
        self.close_modal(window, cx);
        self.focus_editor(window, cx);
        cx.notify();
    }

    pub(crate) fn tick_writing(&mut self, cx: &mut Context<Self>) {
        let Some(session) = &mut self.writing else {
            return;
        };
        if self.locked
            || self.settings
            || self.active_folder.is_some()
            || self.active != session.note
            || self.backend.root != session.root
        {
            self.writing = None;
            cx.notify();
            return;
        }
        // Round up, and use elapsed wall time rather than counting poll ticks.
        let left = session.deadline.saturating_duration_since(Instant::now());
        let seconds = left.as_secs() + u64::from(left.subsec_nanos() > 0);
        if seconds != session.seconds {
            session.seconds = seconds;
            cx.notify();
        }
    }
}
