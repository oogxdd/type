fn main() {
    println!("cargo:rerun-if-changed=native/updater.m");
    println!("cargo:rerun-if-changed=native/audio.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/updater.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("type_updater");
        cc::Build::new()
            .file("native/audio.m")
            .flag("-fobjc-arc")
            .compile("type_audio");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
}
