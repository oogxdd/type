# Type 0.4.14

Native GPUI desktop release for macOS 12 or newer on Apple Silicon (M-series) and Intel Macs.

- Writing practice: use the timer next to New note, choose a duration (15 minutes by default), and start writing in a new note with the sidebar hidden. A countdown stays visible; when time is up you can keep writing or choose Finish. Notes use normal autosave.
- Commands: Cmd+/ now opens the same palette as Cmd+K. Toggle line numbers directly from the palette; the choice is remembered.
- Markdown preview: Cmd+E switches between source and rendered Markdown, including tables and images. Wide tables scroll horizontally and can open in a dedicated table view.
- Open Folder: preview CSV/TSV and JSON records in sortable tables, and read DOCX documents without modifying the originals.
- Links: HTTP and HTTPS links are colored and open with Cmd-click, including after scrolling. Listing hover previews are kept out of the release.

Universal macOS build signed with Developer ID, notarized by Apple and delivered through the native GPUI updater. Intel runtime execution has not been tested on a physical Intel Mac. Linux and Windows builds are not included in this release.
