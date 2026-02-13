fn main() {
    tauri_build::build();

    // iOS linking path for Tauri uses Xcode as the final linker. Make sure
    // zlib/iconv are explicitly propagated for libgit2 symbols.
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") {
        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=iconv");
    }
}
