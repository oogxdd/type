//! Synthetic-only reproduction of repeated status hashing with a stale index.
//! Run: cargo run -p type-core --example git_status_perf
use git2::{IndexTime, Repository, StatusOptions};
use std::{fs, path::Path, time::Instant};

fn stale_stats(root: &Path) {
    let repo = Repository::open(root).unwrap();
    let mut index = repo.index().unwrap();
    let entries: Vec<_> = index.iter().collect();
    for mut entry in entries {
        entry.mtime = IndexTime::new(1, 0);
        entry.ctime = IndexTime::new(1, 0);
        index.add(&entry).unwrap();
    }
    index.write().unwrap();
}

fn main() {
    let root = std::env::temp_dir().join(format!("type-status-perf-{}", uuid::Uuid::now_v7()));
    fs::create_dir_all(root.join("_system/_recordings")).unwrap();
    fs::create_dir_all(root.join("_system/stream")).unwrap();
    let repo = Repository::init(&root).unwrap();
    let audio: Vec<u8> = (0..8 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
    for i in 0..16 {
        fs::write(root.join(format!("_system/_recordings/{i}.m4a")), &audio).unwrap();
    }
    for i in 0..2000 {
        fs::write(
            root.join(format!("_system/stream/{i}.md")),
            format!("Synthetic note {i}: שלום\n"),
        )
        .unwrap();
    }
    type_core::commit_all_changes(&repo, "synthetic fixture", "main").unwrap();
    drop(repo);
    println!("Synthetic fixture: 2000 notes + 128 MiB of tracked recordings");
    for update_index in [false, true] {
        stale_stats(&root);
        for pass in 1..=3 {
            // Each app command reopens the repository, so cache must survive it.
            let repo = Repository::open(&root).unwrap();
            let mut options = StatusOptions::new();
            options
                .include_untracked(true)
                .recurse_untracked_dirs(true)
                .renames_head_to_index(true)
                .update_index(update_index);
            let start = Instant::now();
            assert!(repo.statuses(Some(&mut options)).unwrap().is_empty());
            println!(
                "update_index={update_index} pass={pass}: {}ms",
                start.elapsed().as_millis()
            );
        }
    }
    for legacy_checkout in [true, false] {
        stale_stats(&root);
        let repo = Repository::open(&root).unwrap();
        let start = Instant::now();
        if legacy_checkout {
            repo.set_head("refs/heads/main").unwrap();
            repo.checkout_head(Some(git2::build::CheckoutBuilder::new().safe()))
                .unwrap();
        } else {
            type_core::switch_or_prepare_branch(&repo, "main").unwrap();
        }
        println!(
            "same-branch legacy_checkout={legacy_checkout}: {}ms",
            start.elapsed().as_millis()
        );
    }
    fs::remove_dir_all(root).unwrap();
}
