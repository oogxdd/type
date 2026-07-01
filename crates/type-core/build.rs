// Replicate Tauri's `desktop` / `mobile` cfg aliases so code moved out of the
// Tauri crate (e.g. the local-sync git daemon host, desktop-only whisper) keeps
// its platform gating without depending on tauri-build.
fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let mobile = target_os == "ios" || target_os == "android";
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(mobile)");
    println!(
        "cargo:rustc-cfg={}",
        if mobile { "mobile" } else { "desktop" }
    );
}
