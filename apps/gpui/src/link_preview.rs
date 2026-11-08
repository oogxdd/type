//! Pure parts of the hover preview for listing links: which links qualify, how
//! the title and photos are read from a rendered page, and the on-disk cache.
//! Loading the page itself (a hidden web view) lives in the app.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

/// How long a cached preview is trusted before the page is read again.
const CACHE_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const MAX_PHOTOS: usize = 12;
const MAX_PHOTO_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Preview {
    pub title: String,
    /// Absolute `https` URLs of the listing photos, in gallery order.
    pub photos: Vec<String>,
}

/// A preview whose photos are already on disk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CachedPreview {
    pub title: String,
    pub files: Vec<PathBuf>,
}

#[derive(Serialize, Deserialize)]
struct Meta {
    title: String,
    files: Vec<String>,
}

fn host_of(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("https://")
        .or(url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?;
    Some(host.rsplit('@').next()?.split(':').next()?)
}

fn is_list_am(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "list.am" || host.ends_with(".list.am")
}

/// Only listing pages of known sites get a preview; hovering other links never
/// touches the network.
pub fn previewable(url: &str) -> bool {
    host_of(url).is_some_and(is_list_am) && listing_id(url).is_some()
}

/// The numeric listing id of `https://www.list.am/ru/item/24148278?...`.
pub fn listing_id(url: &str) -> Option<&str> {
    let path = url.split(['?', '#']).next()?;
    let id = path.split("/item/").nth(1)?.split('/').next()?;
    (!id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())).then_some(id)
}

/// Stable cache directory name; tracking parameters (`?ld_src=2`) are ignored.
pub fn cache_key(url: &str) -> String {
    let stable = url.split(['?', '#']).next().unwrap_or(url);
    let mut hash = 0xcbf29ce484222325u64;
    for byte in stable.to_ascii_lowercase().bytes() {
        hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let decoded = rest.find(';').filter(|end| *end <= 10).and_then(|end| {
            let name = &rest[1..end];
            let ch = match name {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" | "#39" => '\'',
                "nbsp" => ' ',
                _ => {
                    let number = name.strip_prefix('#')?;
                    let code = match number.strip_prefix(['x', 'X']) {
                        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                        None => number.parse().ok()?,
                    };
                    char::from_u32(code)?
                }
            };
            Some((ch, end + 1))
        });
        match decoded {
            Some((ch, used)) => {
                out.push(ch);
                rest = &rest[used..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    decode_entities(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn heading(html: &str) -> Option<String> {
    let start = html.find("<h1")?;
    let open_end = start + html[start..].find('>')? + 1;
    let end = open_end + html[open_end..].find("</h1>")?;
    let title = strip_tags(&html[open_end..end]);
    (!title.is_empty()).then_some(title)
}

fn meta_content(html: &str, property: &str) -> Option<String> {
    let needle = format!("property=\"{property}\"");
    let at = html.find(&needle)?;
    let tag_start = html[..at].rfind("<meta")?;
    let tag_end = at + html[at..].find('>')?;
    let tag = &html[tag_start..tag_end];
    let value_start = tag.find("content=\"")? + "content=\"".len();
    let value = &tag[value_start..];
    Some(decode_entities(&value[..value.find('"')?]))
}

fn page_title(html: &str) -> Option<String> {
    let start = html.find("<title")?;
    let open_end = start + html[start..].find('>')? + 1;
    let end = open_end + html[open_end..].find("</title>")?;
    let title = strip_tags(&html[open_end..end]);
    let title = title.strip_suffix(" - List.am").unwrap_or(&title).trim();
    (!title.is_empty()).then(|| title.to_string())
}

fn absolute_photo(raw: &str) -> Option<String> {
    let url = if let Some(rest) = raw.strip_prefix("//") {
        format!("https://{rest}")
    } else {
        raw.to_string()
    };
    // Photos are fetched without a browser, so only the site's own image hosts
    // named by the page are accepted.
    let host = host_of(&url)?;
    (url.starts_with("https://") && is_list_am(host) && !url.contains(['"', '\'', ' ', '\\']))
        .then_some(url)
}

/// The `img:[...]` array of the page's gallery script.
fn gallery(html: &str) -> Vec<String> {
    let mut photos = Vec::new();
    let Some(init) = html.find(".init('#") else {
        return photos;
    };
    let Some(array) = html[init..].find("img:[") else {
        return photos;
    };
    let body = &html[init + array + "img:[".len()..];
    let body = &body[..body.find(']').unwrap_or(0)];
    for item in body.split(',') {
        let item = item.trim().trim_matches(['"', '\'']);
        if let Some(url) = absolute_photo(item) {
            if !photos.contains(&url) {
                photos.push(url);
            }
        }
        if photos.len() == MAX_PHOTOS {
            break;
        }
    }
    photos
}

/// Read the title and photos of a rendered listing page. `None` means the page
/// is not (yet) a listing, for example a bot-check page that is still running.
pub fn parse(html: &str) -> Option<Preview> {
    let mut photos = gallery(html);
    if photos.is_empty() {
        photos = meta_content(html, "og:image")
            .and_then(|url| absolute_photo(&url))
            .into_iter()
            .collect();
    }
    if photos.is_empty() {
        return None;
    }
    let title = heading(html)
        .or_else(|| meta_content(html, "og:title"))
        .or_else(|| page_title(html))?;
    Some(Preview { title, photos })
}

/// The cached preview for `url`, if present and fresh.
pub fn load_cached(root: &Path, url: &str) -> Option<CachedPreview> {
    let dir = root.join(cache_key(url));
    let meta_path = dir.join("meta.json");
    let age = SystemTime::now()
        .duration_since(fs::metadata(&meta_path).ok()?.modified().ok()?)
        .unwrap_or_default();
    if age > CACHE_TTL {
        return None;
    }
    let meta: Meta = serde_json::from_slice(&fs::read(&meta_path).ok()?).ok()?;
    let files = meta
        .files
        .iter()
        .map(|name| dir.join(name))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    (!files.is_empty()).then_some(CachedPreview {
        title: meta.title,
        files,
    })
}

fn extension(url: &str) -> &'static str {
    match url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .rsplit('.')
        .next()
    {
        Some("png") => "png",
        Some("webp") => "webp",
        Some("gif") => "gif",
        _ => "jpg",
    }
}

/// Download the photos into the cache and write its metadata. Photos that fail
/// are skipped; no photo at all is an error.
pub fn download(root: &Path, url: &str, preview: &Preview) -> Result<CachedPreview, String> {
    let dir = root.join(cache_key(url));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
             (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        )
        .build()
        .map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    for (index, photo) in preview.photos.iter().enumerate() {
        let name = format!("{index}.{}", extension(photo));
        let fetched = client
            .get(photo)
            .header("Referer", "https://www.list.am/")
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.bytes());
        match fetched {
            Ok(bytes) if !bytes.is_empty() && bytes.len() <= MAX_PHOTO_BYTES => {
                let temp = dir.join(format!("{name}.part"));
                if fs::write(&temp, &bytes).is_ok() && fs::rename(&temp, dir.join(&name)).is_ok() {
                    names.push(name);
                }
            }
            _ => {}
        }
    }
    if names.is_empty() {
        return Err("No photo could be downloaded.".into());
    }
    let meta = Meta {
        title: preview.title.clone(),
        files: names.clone(),
    };
    let bytes = serde_json::to_vec(&meta).map_err(|e| e.to_string())?;
    let temp = dir.join("meta.json.part");
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, dir.join("meta.json")).map_err(|e| e.to_string())?;
    Ok(CachedPreview {
        title: preview.title.clone(),
        files: names.iter().map(|name| dir.join(name)).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"<html><head>
<title>House &amp; garden, 100 sq.m. - Дом - List.am</title>
<meta property="og:image" content="https://img.list.am/f/213/1.jpg">
</head><body><h1 itemprop="name">Дом &quot;Тест&quot;, <b>Ванадзор</b></h1>
<div id="po127"><img src="//img.list.am/f/213/1.jpg"><img src=""></div>
<script>po127.init('#po127', {img:["//img.list.am/f/213/1.jpg","//img.list.am/f/214/2.jpg","//img.list.am/f/214/2.jpg","//evil.example/x.jpg","//img.list.am/f/221/3.png"]});</script>
</body></html>"#;

    #[test]
    fn only_listing_pages_of_known_sites_are_previewed() {
        assert!(previewable("https://www.list.am/ru/item/24148278?ld_src=2"));
        assert!(previewable("http://list.am/item/1"));
        assert!(!previewable("https://www.list.am/ru/category/62"));
        assert!(!previewable("https://list.am.evil.example/ru/item/1"));
        assert!(!previewable("https://example.com/item/1"));
        assert_eq!(
            listing_id("https://www.list.am/ru/item/24148278?x=1"),
            Some("24148278")
        );
        assert_eq!(listing_id("https://www.list.am/ru/item/abc"), None);
    }

    #[test]
    fn reads_title_and_photos_from_the_rendered_page() {
        let preview = parse(PAGE).unwrap();
        assert_eq!(preview.title, "Дом \"Тест\", Ванадзор");
        assert_eq!(
            preview.photos,
            [
                "https://img.list.am/f/213/1.jpg",
                "https://img.list.am/f/214/2.jpg",
                "https://img.list.am/f/221/3.png"
            ]
        );
    }

    #[test]
    fn falls_back_to_the_cover_and_page_title_and_waits_for_real_pages() {
        let cover = r#"<title>Flat - List.am</title><meta property="og:image" content="https://img.list.am/f/1/1.jpg">"#;
        let preview = parse(cover).unwrap();
        assert_eq!(preview.title, "Flat");
        assert_eq!(preview.photos.len(), 1);
        assert_eq!(parse("<title>Just a moment...</title>"), None);
    }

    #[test]
    fn cache_ignores_tracking_parameters_and_expires() {
        assert_eq!(
            cache_key("https://www.list.am/ru/item/1?ld_src=2"),
            cache_key("https://www.list.am/ru/item/1")
        );
        assert_ne!(
            cache_key("https://www.list.am/ru/item/1"),
            cache_key("https://www.list.am/ru/item/2")
        );
        let root = std::env::temp_dir().join(format!("type-link-preview-{}", std::process::id()));
        let url = "https://www.list.am/ru/item/7";
        let dir = root.join(cache_key(url));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("0.jpg"), b"x").unwrap();
        fs::write(
            dir.join("meta.json"),
            br#"{"title":"T","files":["0.jpg","missing.jpg"]}"#,
        )
        .unwrap();
        let cached = load_cached(&root, url).unwrap();
        assert_eq!(cached.title, "T");
        assert_eq!(cached.files, [dir.join("0.jpg")]);
        let old = SystemTime::now() - CACHE_TTL - Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(dir.join("meta.json"))
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert_eq!(load_cached(&root, url), None);
        let _ = fs::remove_dir_all(root);
    }
}
