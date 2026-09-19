# Полный внешний API Type

Группировка по смыслу: Iroh включён в local_sync, очистка аудиокэша — в recordings. Это не переименование Rust-модулей.

D — desktop, M — mobile, DM — обе платформы. «Ссылки» — статически найденные обращения из apps/*/src вне API-обёрток и тестов, включая передачу функции как callback. Это не трассировка исполнения: условный или скрытый UI может не исполняться. «—» означает, что таких ссылок не найдено.

## notes

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `get_tree` | DM | DM | [apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:95](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:95); [apps/mobile/src/state/notes-store.ts:82](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/notes-store.ts:82) |
| `read_note` | DM | DM | [apps/desktop/src/features/lens/components/multi-note-review.tsx:41](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/lens/components/multi-note-review.tsx:41); [apps/mobile/src/screens/editor-screen.tsx:50](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/editor-screen.tsx:50) |
| `get_absolute_path` | D | D | [apps/desktop/src/desktop/desktop-context-menu.tsx:53](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/desktop/desktop-context-menu.tsx:53) |
| `create_note` | DM | DM | [apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:101](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:101); [apps/mobile/src/screens/capture-screen.tsx:207](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/capture-screen.tsx:207) |
| `write_note` | DM | DM | [apps/desktop/src/desktop/hooks/use-desktop-editor-pane.ts:73](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/desktop/hooks/use-desktop-editor-pane.ts:73); [apps/mobile/src/screens/capture-screen.tsx:212](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/capture-screen.tsx:212) |
| `set_note_timestamp` | DM | — | — |
| `update_note_markers` | DM | DM | [apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:443](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:443); [apps/mobile/src/state/notes-store.ts:183](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/notes-store.ts:183) |
| `get_note_meta` | DM | DM | [apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:158](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts:158); [apps/mobile/src/screens/editor-screen.tsx:59](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/editor-screen.tsx:59) |
| `list_note_previews` | DM | DM | [apps/desktop/src/features/notes/list/hooks/use-note-previews.ts:111](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/list/hooks/use-note-previews.ts:111); [apps/mobile/src/state/notes-store.ts:29](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/notes-store.ts:29) |
| `move_items` | DM | DM | [apps/desktop/src/features/notes/navigation/hooks/use-drag-drop.ts:323](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/navigation/hooks/use-drag-drop.ts:323); [apps/mobile/src/state/notes-store.ts:166](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/notes-store.ts:166) |
| `delete_items` | DM | DM | [apps/desktop/src/features/notes/editor/hooks/use-note-editor.ts:83](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/editor/hooks/use-note-editor.ts:83); [apps/mobile/src/screens/capture-screen.tsx:216](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/capture-screen.tsx:216) |
| `rename_item` | DM | D | [apps/desktop/src/features/notes/editor/hooks/use-note-editor.ts:98](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/editor/hooks/use-note-editor.ts:98) |
| `set_order` | DM | D | [apps/desktop/src/features/notes/navigation/hooks/use-drag-drop.ts:347](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/notes/navigation/hooks/use-drag-drop.ts:347) |
| `update_note_tags` | DM | — | — |

## profiles

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `get_profiles` | DM | DM | [apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:35](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:35); [apps/mobile/src/state/settings-store.ts:94](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/settings-store.ts:94) |
| `create_profile` | DM | DM | [apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:121](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:121); [apps/mobile/src/state/settings-store.ts:99](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/settings-store.ts:99) |
| `set_active_profile` | DM | DM | [apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:103](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:103); [apps/mobile/src/state/settings-store.ts:104](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/settings-store.ts:104) |
| `set_profile_notes_root` | DM | DM | [apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:156](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:156); [apps/mobile/src/state/settings-store.ts:109](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/settings-store.ts:109) |
| `update_profile` | DM | D | [apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:132](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:132) |
| `delete_profile` | DM | D | [apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:143](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-profile-actions.ts:143) |
| `update_profile_settings` | DM | DM | [apps/desktop/src/features/profiles/hooks/use-legacy-profile-sync-migration.ts:60](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-legacy-profile-sync-migration.ts:60); [apps/mobile/src/state/settings-store.ts:69](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/settings-store.ts:69) |
| `update_app_config` | DM | DM | [apps/desktop/src/features/profiles/hooks/use-legacy-profile-sync-migration.ts:44](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/profiles/hooks/use-legacy-profile-sync-migration.ts:44); [apps/mobile/src/state/settings-store.ts:160](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/settings-store.ts:160) |
| `create_profiles_backup_zip` | DM | M | [apps/mobile/src/screens/settings-screen.tsx:197](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/settings-screen.tsx:197) |
| `export_profiles_to_documents` | DM | — | — |

## security

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `get_security_state` | DM | DM | [apps/desktop/src/features/security/hooks/security-context.tsx:47](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/security/hooks/security-context.tsx:47); [apps/mobile/src/state/security-store.ts:30](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/security-store.ts:30) |
| `enable_security` | DM | D | [apps/desktop/src/features/security/hooks/security-context.tsx:66](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/security/hooks/security-context.tsx:66) |
| `lock_security` | DM | DM | [apps/desktop/src/features/security/hooks/security-context.tsx:120](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/security/hooks/security-context.tsx:120); [apps/mobile/src/state/security-store.ts:64](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/security-store.ts:64) |
| `unlock_security` | DM | DM | [apps/desktop/src/features/security/hooks/security-context.tsx:85](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/security/hooks/security-context.tsx:85); [apps/mobile/src/state/security-store.ts:39](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/security-store.ts:39) |
| `set_security_preferences` | DM | D | [apps/desktop/src/features/security/hooks/security-context.tsx:135](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/security/hooks/security-context.tsx:135) |

## recordings

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `save_audio_recording` | DM | DM | [apps/desktop/src/features/recording/hooks/recordings-context.tsx:184](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/recordings-context.tsx:184); [apps/mobile/src/ui/dictation-button.tsx:190](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/ui/dictation-button.tsx:190) |
| `queue_recording_transcriptions` | DM | DM | [apps/desktop/src/features/recording/hooks/recordings-context.tsx:116](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/recordings-context.tsx:116); [apps/mobile/src/ui/dictation-button.tsx:199](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/ui/dictation-button.tsx:199) |
| `queue_local_transcriptions` | D | D | [apps/desktop/src/features/recording/hooks/recordings-context.tsx:118](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/recordings-context.tsx:118) |
| `retrigger_transcription` | D | D | [apps/desktop/src/features/recording/hooks/recordings-context.tsx:147](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/recordings-context.tsx:147) |
| `check_whisper_status` | D | D | [apps/desktop/src/features/settings/components/desktop/whisper-engine-card.tsx:26](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/settings/components/desktop/whisper-engine-card.tsx:26) |
| `list_recordings` | DM | D | [apps/desktop/src/features/recording/hooks/recordings-context.tsx:64](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/recordings-context.tsx:64) |
| `read_recording_audio` | DM | M | [apps/mobile/src/ui/audio-player.tsx:48](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/ui/audio-player.tsx:48) |
| `resolve_recording_audio_path` | D | D | [apps/desktop/src/features/recording/hooks/recordings-context.tsx:88](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/recordings-context.tsx:88) |
| `import_audio_files` | D | D | [apps/desktop/src/features/recording/hooks/use-audio-import.ts:103](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/use-audio-import.ts:103) |
| `audio_import_status` | D | D | [apps/desktop/src/features/recording/hooks/use-audio-import.ts:50](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/recording/hooks/use-audio-import.ts:50) |
| `queue_provider_transcriptions` | M | M | [apps/mobile/src/ui/dictation-button.tsx:205](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/ui/dictation-button.tsx:205) |
| `prune_mobile_audio_cache` | M | M | [apps/mobile/src/state/sync-store.ts:197](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:197) |

## handwriting

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `save_handwriting_attachment` | DM | DM | [apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx:174](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx:174); [apps/mobile/src/ui/dictation-button.tsx:284](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/ui/dictation-button.tsx:284) |
| `queue_handwriting_ocr` | D | D | [apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx:146](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx:146) |
| `list_handwriting_ocr_jobs` | D | D | [apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx:104](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx:104) |
| `check_local_ocr_status` | D | D | [apps/desktop/src/features/settings/components/desktop/local-ocr-engine-card.tsx:31](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/settings/components/desktop/local-ocr-engine-card.tsx:31) |

## import

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `scan_apple_notes_folder` | D | D | [apps/desktop/src/features/import/hooks/use-apple-import.ts:112](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/import/hooks/use-apple-import.ts:112) |
| `start_apple_notes_import` | D | D | [apps/desktop/src/features/import/hooks/use-apple-import.ts:128](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/import/hooks/use-apple-import.ts:128) |
| `apple_import_status` | D | D | [apps/desktop/src/features/import/hooks/use-apple-import.ts:58](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/import/hooks/use-apple-import.ts:58) |

## git_sync

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `generate_ssh_key` | DM | DM | [apps/desktop/src/features/sync/hooks/use-ssh-key.ts:51](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-ssh-key.ts:51); [apps/mobile/src/screens/sync-screen.tsx:402](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/sync-screen.tsx:402) |
| `get_ssh_public_key` | DM | DM | [apps/desktop/src/features/sync/hooks/use-ssh-key.ts:36](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-ssh-key.ts:36); [apps/mobile/src/screens/sync-screen.tsx:93](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/sync-screen.tsx:93) |
| `delete_ssh_key` | DM | DM | [apps/desktop/src/features/sync/hooks/use-ssh-key.ts:67](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-ssh-key.ts:67); [apps/mobile/src/screens/sync-screen.tsx:390](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/screens/sync-screen.tsx:390) |
| `get_git_status` | DM | DM | [apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:55](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:55); [apps/mobile/src/state/sync-store.ts:409](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:409) |
| `get_git_sync_progress` | DM | M | [apps/mobile/src/state/sync-store.ts:282](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:282) |
| `get_git_history` | DM | DM | [apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:70](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:70); [apps/mobile/src/state/sync-store.ts:287](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:287) |
| `connect_git_repo` | DM | DM | [apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:93](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:93); [apps/mobile/src/state/sync-store.ts:266](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:266) |
| `git_pull` | DM | DM | [apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:145](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:145); [apps/mobile/src/state/sync-store.ts:541](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:541) |
| `git_commit` | DM | DM | [apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:183](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:183); [apps/mobile/src/state/sync-store.ts:580](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:580) |
| `git_push` | DM | DM | [apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:219](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts:219); [apps/mobile/src/state/sync-store.ts:627](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:627) |

## local_sync

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `get_local_sync_server_status` | D | D | [apps/desktop/src/features/sync/hooks/use-local-sync-server.ts:35](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-local-sync-server.ts:35) |
| `start_local_sync_server` | D | D | [apps/desktop/src/features/sync/hooks/use-local-sync-server.ts:65](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-local-sync-server.ts:65) |
| `stop_local_sync_server` | D | D | [apps/desktop/src/features/sync/hooks/use-local-sync-server.ts:64](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/sync/hooks/use-local-sync-server.ts:64) |
| `discover_local_sync_servers` | D | — | — |
| `start_iroh_sync_client` | M | M | [apps/mobile/src/state/sync-store.ts:130](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:130) |
| `iroh_client_status` | M | M | [apps/mobile/src/state/sync-store.ts:219](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:219) |
| `archive_mobile_audio_with_iroh` | M | M | [apps/mobile/src/state/sync-store.ts:171](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:171) |
| `set_mobile_audio_git_exclusion` | M | M | [apps/mobile/src/state/sync-store.ts:153](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/state/sync-store.ts:153) |

## tag_registry

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `read_tag_registry` | DM | D | [apps/desktop/src/features/tags/hooks/tags-context.tsx:23](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/tags/hooks/tags-context.tsx:23) |
| `write_tag_registry` | DM | D | [apps/desktop/src/features/tags/hooks/tags-context.tsx:39](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/features/tags/hooks/tags-context.tsx:39) |

## shell

| Функция | Экспорт API | Ссылки в приложениях | Примеры исходников |
|---|---|---|---|
| `set_app_icon` | D | D | [apps/desktop/src/app/state/app-icon-store.tsx:36](/Volumes/KINGSTON/Projects/type/app/apps/desktop/src/app/state/app-icon-store.tsx:36) |
| `init_core` | M | M | [apps/mobile/src/core/boot.ts:39](/Volumes/KINGSTON/Projects/type/app/apps/mobile/src/core/boot.ts:39) |
