# Type brand assets

`branch-original-512.png` is the untouched transparent branch that was already
used by the Tauri icon set. It is the source of truth and the easy rollback
path; generated files never replace it.

Run `node scripts/generate-brand-assets.mjs` from the repository root to rebuild
the desktop splash, iOS icon, iOS splash image, and Expo icon inputs. The script
uses the already-installed `pngjs` workspace dependency and deterministic
bilinear resizing. It does not build either app or install anything.

The mobile icon deliberately places the branch on a near-black blue-grey field:
iOS app icons cannot use transparency, and the OS supplies the final rounded
mask. Desktop keeps the transparent branch with no tile or container.

To revert to the non-upscaled splash, point the desktop/mobile splash directly
at `branch-original-512.png`, or copy that file over the generated splash image.
