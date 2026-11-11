use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use type_gpui::search::{self, Results};

#[derive(Default)]
pub(crate) struct State {
    pub results: Results,
    pub pending: bool,
    generation: usize,
    cancel: Option<Arc<AtomicBool>>,
    task: Option<Task<()>>,
}
impl Drop for State {
    fn drop(&mut self) {
        if let Some(cancel) = &self.cancel {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}
impl TypeApp {
    pub(crate) fn clear_search(&mut self) {
        if let Some(cancel) = self.search.cancel.take() {
            cancel.store(true, Ordering::Relaxed);
        }
        self.search.task = None;
        self.search.generation += 1;
        self.search.pending = false;
        self.search.results = Results::default();
    }
    pub(crate) fn query_search(&mut self, cx: &mut Context<Self>) {
        self.clear_search();
        let Some(modal) = self
            .modal
            .as_ref()
            .filter(|m| matches!(m.kind, commands::ModalKind::Search))
        else {
            return;
        };
        let query = modal.input.read(cx).value().to_string();
        if query.trim().is_empty() || self.locked {
            cx.notify();
            return;
        }
        self.error = None;
        let generation = self.search.generation;
        let cancel = Arc::new(AtomicBool::new(false));
        self.search.cancel = Some(cancel.clone());
        self.search.pending = true;
        let backend = self.backend.clone();
        let executor = cx.background_executor().clone();
        self.search.task = Some(cx.spawn(async move |view, cx| {
            executor.timer(Duration::from_millis(180)).await;
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let result = executor
                .spawn(async move { search::scan(&backend, &query, &cancel) })
                .await;
            let _ = view.update(cx, |this, cx| {
                if this.locked
                    || this.search.generation != generation
                    || !this
                        .modal
                        .as_ref()
                        .is_some_and(|m| matches!(m.kind, commands::ModalKind::Search))
                {
                    return;
                }
                this.search.pending = false;
                match result {
                    Ok(results) => this.search.results = results,
                    Err(error) => this.error = Some(error),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    pub(crate) fn open_search_result(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.search.pending || self.locked {
            return;
        }
        let Some(modal) = &self.modal else {
            return;
        };
        let Some(hit) = self.search.results.hits.get(modal.selected) else {
            return;
        };
        let path: SharedString = hit.path.clone().into();
        self.close_modal(window, cx);
        self.settings = false;
        self.open_note(path, true, window, cx);
    }
    pub(crate) fn search_key(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.keystroke.key.as_str() {
            "escape" => self.close_modal(window, cx),
            "enter" => self.open_search_result(window, cx),
            "up" | "down" => {
                let count = self.search.results.hits.len();
                if let Some(modal) = &mut self.modal {
                    modal.selected = if event.keystroke.key == "up" {
                        modal.selected.saturating_sub(1)
                    } else {
                        (modal.selected + 1).min(count.saturating_sub(1))
                    };
                }
            }
            _ => return,
        }
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
    }
}
