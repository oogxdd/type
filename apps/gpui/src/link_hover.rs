//! Hover preview for listing links: title and a photo slider in a popup.
//!
//! The site sits behind a browser check, so the page is read once through a
//! hidden web view (a real browser engine); the photos are then downloaded with
//! a plain client and cached on disk. Hovering the same link again costs no
//! network.

use super::*;
use gpui_kit::base::input::Rope;
use gpui_kit::component::input::HoverProvider;
use serde::Deserialize;
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    path::PathBuf,
    rc::Rc,
    sync::{Arc, Mutex},
};
use type_gpui::link_preview::{self, CachedPreview};

/// The pointer may cross the gap between a link and its popup for this long.
const GRACE: Duration = Duration::from_millis(250);
const RETRY_AFTER: Duration = Duration::from_secs(30);
const PAGE_ATTEMPTS: usize = 45;
const POPUP_WIDTH: f32 = 360.;
const PHOTO_HEIGHT: f32 = 270.;

enum Entry {
    Loading,
    Ready(CachedPreview),
    Failed(Instant),
}

struct Active {
    url: String,
    anchor: Point<Pixels>,
    index: usize,
}

struct State {
    root: PathBuf,
    entries: HashMap<String, Entry>,
    active: Option<Active>,
    queue: VecDeque<String>,
    running: bool,
    webview: Option<wry::WebView>,
    on_link: bool,
    popup_hover: bool,
}

#[derive(Clone)]
struct Hub(Rc<RefCell<State>>);
impl Global for Hub {}

/// Enable link previews; `root` is the cache folder inside the app data.
pub fn install(root: PathBuf, cx: &mut App) {
    cx.set_global(Hub(Rc::new(RefCell::new(State {
        root,
        entries: HashMap::new(),
        active: None,
        queue: VecDeque::new(),
        running: false,
        webview: None,
        on_link: false,
        popup_hover: false,
    }))));
}

fn hub(cx: &App) -> Option<Hub> {
    cx.has_global::<Hub>().then(|| cx.global::<Hub>().clone())
}

/// Close the popup, for example because the text changed.
pub fn dismiss(cx: &mut App) {
    if let Some(hub) = hub(cx) {
        let mut state = hub.0.borrow_mut();
        state.on_link = false;
        state.popup_hover = false;
        if state.active.take().is_some() {
            drop(state);
            cx.refresh_windows();
        }
    }
}

/// The pointer entered or left the editor pane.
pub fn pane_hover(hovered: bool, cx: &mut App) {
    if !hovered && let Some(hub) = hub(cx) {
        hub.0.borrow_mut().on_link = false;
        hub.schedule_hide(cx);
    }
}

fn popup_hover(hovered: bool, cx: &mut App) {
    if let Some(hub) = hub(cx) {
        hub.0.borrow_mut().popup_hover = hovered;
        if !hovered {
            hub.schedule_hide(cx);
        }
    }
}

fn step(delta: isize, cx: &mut App) {
    if let Some(hub) = hub(cx) {
        {
            let mut state = hub.0.borrow_mut();
            let State {
                active, entries, ..
            } = &mut *state;
            let Some(active) = active else { return };
            let Some(Entry::Ready(preview)) = entries.get(&link_preview::cache_key(&active.url))
            else {
                return;
            };
            let count = preview.files.len() as isize;
            active.index = (active.index as isize + delta).rem_euclid(count.max(1)) as usize;
        }
        cx.refresh_windows();
    }
}

#[derive(Deserialize)]
struct Page {
    href: String,
    html: String,
}

const READ_PAGE: &str =
    "JSON.stringify({href: location.href, html: document.documentElement.outerHTML})";

impl Hub {
    fn schedule_hide(&self, cx: &mut App) {
        if self.0.borrow().active.is_none() {
            return;
        }
        let hub = self.clone();
        cx.spawn(async move |cx| {
            cx.background_executor().timer(GRACE).await;
            let hidden = {
                let mut state = hub.0.borrow_mut();
                (!state.on_link && !state.popup_hover && state.active.take().is_some())
                    .then_some(())
            };
            if hidden.is_some() {
                cx.update(|cx| cx.refresh_windows());
            }
        })
        .detach();
    }

    /// The pointer rests over `link` (or over no link at all).
    fn pointer_at(&self, link: Option<String>, window: &mut Window, cx: &mut App) {
        let Some(url) = link.filter(|url| link_preview::previewable(url)) else {
            self.0.borrow_mut().on_link = false;
            self.schedule_hide(cx);
            return;
        };
        let mut start = false;
        {
            let mut state = self.0.borrow_mut();
            state.on_link = true;
            if state.active.as_ref().is_some_and(|a| a.url == url) {
                return;
            }
            state.active = Some(Active {
                url: url.clone(),
                anchor: window.mouse_position(),
                index: 0,
            });
            let key = link_preview::cache_key(&url);
            let known = match state.entries.get(&key) {
                Some(Entry::Loading | Entry::Ready(_)) => true,
                Some(Entry::Failed(at)) => at.elapsed() < RETRY_AFTER,
                None => false,
            };
            if !known {
                if let Some(cached) = link_preview::load_cached(&state.root, &url) {
                    state.entries.insert(key, Entry::Ready(cached));
                } else {
                    match state.webview.is_some() || ensure_webview(&mut state, window) {
                        true => {
                            state.entries.insert(key, Entry::Loading);
                            state.queue.push_back(url);
                            start = true;
                        }
                        false => {
                            state.entries.insert(key, Entry::Failed(Instant::now()));
                        }
                    }
                }
            }
        }
        if start {
            self.pump(cx);
        }
        cx.refresh_windows();
    }

    /// Read queued pages one at a time; one hidden web view serves them all.
    fn pump(&self, cx: &mut App) {
        if std::mem::replace(&mut self.0.borrow_mut().running, true) {
            return;
        }
        let hub = self.clone();
        cx.spawn(async move |cx| {
            loop {
                let next = hub.0.borrow_mut().queue.pop_front();
                let Some(url) = next else { break };
                let result = hub.fetch(&url, cx).await;
                hub.0.borrow_mut().entries.insert(
                    link_preview::cache_key(&url),
                    match result {
                        Ok(preview) => Entry::Ready(preview),
                        Err(_) => Entry::Failed(Instant::now()),
                    },
                );
                cx.update(|cx| cx.refresh_windows());
            }
            hub.0.borrow_mut().running = false;
        })
        .detach();
    }

    async fn fetch(&self, url: &str, cx: &mut AsyncApp) -> Result<CachedPreview, String> {
        let id = link_preview::listing_id(url).ok_or("Not a listing.")?;
        let marker = format!("/item/{id}");
        self.with_webview(|webview| webview.load_url(url))?;
        for _ in 0..PAGE_ATTEMPTS {
            cx.background_executor()
                .timer(Duration::from_millis(800))
                .await;
            let slot = Arc::new(Mutex::new(None::<String>));
            let writer = slot.clone();
            self.with_webview(|webview| {
                webview.evaluate_script_with_callback(READ_PAGE, move |value| {
                    *writer.lock().unwrap() = Some(value);
                })
            })?;
            cx.background_executor()
                .timer(Duration::from_millis(300))
                .await;
            let Some(raw) = slot.lock().unwrap().take() else {
                continue;
            };
            let Some(page) = serde_json::from_str::<String>(&raw)
                .ok()
                .and_then(|json| serde_json::from_str::<Page>(&json).ok())
            else {
                continue;
            };
            // The previous page may still be showing right after navigation.
            if !page.href.contains(&marker) {
                continue;
            }
            if let Some(preview) = link_preview::parse(&page.html) {
                let root = self.0.borrow().root.clone();
                let url = url.to_string();
                return cx
                    .background_spawn(async move { link_preview::download(&root, &url, &preview) })
                    .await;
            }
        }
        Err("The page did not load.".into())
    }

    fn with_webview<R>(
        &self,
        action: impl FnOnce(&wry::WebView) -> wry::Result<R>,
    ) -> Result<R, String> {
        let state = self.0.borrow();
        let webview = state.webview.as_ref().ok_or("No web view.")?;
        action(webview).map_err(|e| e.to_string())
    }
}

/// A browser-sized view kept outside the visible window area. It must belong to
/// a visible window, or the engine may throttle the page.
fn ensure_webview(state: &mut State, window: &mut Window) -> bool {
    use wry::{
        Rect,
        dpi::{LogicalPosition, LogicalSize},
    };
    let built = wry::WebViewBuilder::new()
        .with_bounds(Rect {
            position: LogicalPosition::new(-4000, -4000).into(),
            size: LogicalSize::new(1280u32, 900u32).into(),
        })
        .with_url("about:blank")
        .build_as_child(window);
    match built {
        Ok(webview) => {
            state.webview = Some(webview);
            true
        }
        Err(_) => false,
    }
}

struct LinkHover;

impl HoverProvider for LinkHover {
    fn hover(
        &self,
        text: &Rope,
        offset: usize,
        window: &mut Window,
        cx: &mut App,
    ) -> Task<anyhow::Result<Option<lsp_types::Hover>>> {
        if let Some(hub) = hub(cx) {
            let text = text.to_string();
            let link = document::link_ranges(&text)
                .into_iter()
                .find(|range| range.contains(&offset))
                .map(|range| text[range].to_string());
            hub.pointer_at(link, window, cx);
        }
        // The engine's own text popover stays empty; the app draws the preview.
        Task::ready(Ok(None))
    }
}

pub(crate) fn provider() -> Rc<dyn HoverProvider> {
    Rc::new(LinkHover)
}

fn card(content: impl IntoElement, anchor: Point<Pixels>, cx: &App) -> AnyElement {
    let theme = cx.theme();
    deferred(
        anchored()
            .position(point(anchor.x - px(16.), anchor.y + px(14.)))
            .anchor(Anchor::TopLeft)
            .snap_to_window_with_margin(px(8.))
            .child(
                v_flex()
                    .id("link-preview")
                    .occlude()
                    .w(px(POPUP_WIDTH))
                    .overflow_hidden()
                    .rounded_lg()
                    .border_1()
                    .border_color(theme.border)
                    .bg(theme.popover)
                    .text_color(theme.popover_foreground)
                    .shadow_lg()
                    .on_hover(|hovered, _, cx| popup_hover(*hovered, cx))
                    .child(content),
            ),
    )
    .priority(10)
    .into_any_element()
}

fn nav(id: &'static str, icon: IconName, delta: isize, left: bool) -> impl IntoElement {
    div()
        .id(id)
        .absolute()
        .top(px(PHOTO_HEIGHT / 2. - 16.))
        .when(left, |button| button.left_2())
        .when(!left, |button| button.right_2())
        .size(px(32.))
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .cursor_pointer()
        .bg(gpui::black().opacity(0.55))
        .text_color(gpui::white())
        .hover(|button| button.bg(gpui::black().opacity(0.75)))
        .on_click(move |_, _, cx| step(delta, cx))
        .child(Icon::new(icon).small())
}

/// The popup for the link under the pointer, if any.
pub(crate) fn popup(cx: &App) -> Option<AnyElement> {
    let hub = hub(cx)?;
    let state = hub.0.borrow();
    let active = state.active.as_ref()?;
    let theme = cx.theme();
    let note = |text: &'static str| {
        div()
            .p_3()
            .text_sm()
            .text_color(theme.muted_foreground)
            .child(text)
    };
    let content = match state.entries.get(&link_preview::cache_key(&active.url)) {
        Some(Entry::Ready(preview)) if !preview.files.is_empty() => {
            let count = preview.files.len();
            let index = active.index.min(count - 1);
            v_flex()
                .child(
                    div()
                        .relative()
                        .w_full()
                        .h(px(PHOTO_HEIGHT))
                        .bg(theme.muted)
                        .child(
                            img(preview.files[index].clone())
                                .size_full()
                                .object_fit(ObjectFit::Contain),
                        )
                        .when(count > 1, |photo| {
                            photo
                                .child(nav("link-preview-prev", IconName::ChevronLeft, -1, true))
                                .child(nav("link-preview-next", IconName::ChevronRight, 1, false))
                        }),
                )
                .child(
                    v_flex()
                        .gap_1()
                        .p_2()
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .line_clamp(2)
                                .child(preview.title.clone()),
                        )
                        .when(count > 1, |footer| {
                            footer.child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child(format!("{} / {count}", index + 1)),
                            )
                        }),
                )
                .into_any_element()
        }
        Some(Entry::Ready(_) | Entry::Failed(_)) => note("Preview unavailable").into_any_element(),
        _ => note("Loading preview…").into_any_element(),
    };
    Some(card(content, active.anchor, cx))
}

/// The open preview: link, photo index and number of photos once loaded.
#[cfg(test)]
pub(crate) fn snapshot(cx: &App) -> Option<(String, usize, usize)> {
    let hub = hub(cx)?;
    let state = hub.0.borrow();
    let active = state.active.as_ref()?;
    let count = match state.entries.get(&link_preview::cache_key(&active.url)) {
        Some(Entry::Ready(preview)) => preview.files.len(),
        _ => 0,
    };
    Some((active.url.clone(), active.index, count))
}
