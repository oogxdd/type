fn main() {
    println!("cargo:rerun-if-changed=native/updater.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/updater.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("type_updater");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
}
