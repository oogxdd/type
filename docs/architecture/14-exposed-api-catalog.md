# 14. Полный внешний API по доменам

Снимок на 2026-09-16: **63 команды Tauri, 52 функции UniFFI, 70 уникальных имён**.
45 имён есть в обеих оболочках, 18 — только в Tauri, 7 — только в UniFFI.
68 имён сгруппированы в девять доменов; ещё два относятся к служебной границе.

[Обзор и схемы](./12-architecture-map.md) · [Предложение shared stores](./13-shared-stores-proposal.md)

## Как читать

- **API:** функция зарегистрирована в Tauri / экспортирована через UniFFI.
- **Вызовы:** в исходниках frontend найдена ссылка на функцию через API-обёртку или прямой invoke; учитывается также передача callback.
- **D** — desktop, **M** — mobile, **DM** — обе платформы, **—** — обращения не найдены.

Это статическая ревизия `apps/desktop/src` и `apps/mobile/src`, без тестов и самих
API-обёрток. Она не доказывает выполнение функции: код может быть extension-gated
или условным. Отсутствие ссылки не означает, что экспорт можно удалить.
Одинаковое имя также не обещает одинаковую сигнатуру; например, desktop registry
API принимает `expectedRoot`, а FFI registry API пока нет.

Подгруппы — смысловые. Iroh показан в `local_sync`, очистка аудиокэша — в
`recordings`; физические пути реализаций не менялись. Включены все внешние
свободные функции этих двух оболочек, но не все внутренние Rust `pub fn`,
не команды сторонних Tauri plugins и не отдельный Node Notes MCP.

## Сводка

| Домен / группа | Tauri | UniFFI | Уникальных имён |
|---|---:|---:|---:|
| `notes` | 14 | 13 | 14 |
| `profiles` | 10 | 10 | 10 |
| `security` | 5 | 5 | 5 |
| `recordings` | 10 | 6 | 12 |
| `handwriting` | 4 | 1 | 4 |
| `import` | 3 | 0 | 3 |
| `git_sync` | 10 | 10 | 10 |
| `local_sync` | 4 | 4 | 8 |
| `tag_registry` | 2 | 2 | 2 |
| `shell` | 1 | 1 | 2 |

## notes

Оболочки: [Tauri/notes.rs](../../apps/desktop/src-tauri/src/commands/notes.rs), [UniFFI/notes.rs](../../crates/type-ffi/src/notes.rs).

### Дерево

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `get_tree` | DM | DM | [desktop](../../apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts#L95) · [mobile](../../apps/mobile/src/state/notes-store.ts#L82) |

### Чтение и запись

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `read_note` | DM | DM | [desktop](../../apps/desktop/src/features/lens/components/multi-note-review.tsx#L41) · [mobile](../../apps/mobile/src/screens/editor-screen.tsx#L50) |
| `create_note` | DM | DM | [desktop](../../apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts#L101) · [mobile](../../apps/mobile/src/screens/capture-screen.tsx#L207) |
| `write_note` | DM | DM | [desktop](../../apps/desktop/src/desktop/hooks/use-desktop-editor-pane.ts#L73) · [mobile](../../apps/mobile/src/screens/capture-screen.tsx#L212) |

### Метаданные

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `get_note_meta` | DM | DM | [desktop](../../apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts#L158) · [mobile](../../apps/mobile/src/screens/editor-screen.tsx#L59) |
| `list_note_previews` | DM | DM | [desktop](../../apps/desktop/src/features/notes/list/hooks/use-note-previews.ts#L111) · [mobile](../../apps/mobile/src/state/notes-store.ts#L29) |
| `set_note_timestamp` | DM | — | — |
| `update_note_markers` | DM | DM | [desktop](../../apps/desktop/src/features/notes/navigation/state/use-notes-tree-actions.ts#L443) · [mobile](../../apps/mobile/src/state/notes-store.ts#L183) |

### Теги

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `update_note_tags` | DM | — | — |

### Файлы и папки

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `get_absolute_path` | D | D | [desktop](../../apps/desktop/src/desktop/desktop-context-menu.tsx#L53) |
| `move_items` | DM | DM | [desktop](../../apps/desktop/src/features/notes/navigation/hooks/use-drag-drop.ts#L323) · [mobile](../../apps/mobile/src/state/notes-store.ts#L166) |
| `delete_items` | DM | DM | [desktop](../../apps/desktop/src/features/notes/editor/hooks/use-note-editor.ts#L83) · [mobile](../../apps/mobile/src/screens/capture-screen.tsx#L216) |
| `rename_item` | DM | D | [desktop](../../apps/desktop/src/features/notes/editor/hooks/use-note-editor.ts#L98) |
| `set_order` | DM | D | [desktop](../../apps/desktop/src/features/notes/navigation/hooks/use-drag-drop.ts#L347) |


## profiles

Оболочки: [Tauri/profiles.rs](../../apps/desktop/src-tauri/src/commands/profiles.rs), [UniFFI/profiles.rs](../../crates/type-ffi/src/profiles.rs).

### Рабочие папки

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `get_profiles` | DM | DM | [desktop](../../apps/desktop/src/features/profiles/hooks/use-profile-actions.ts#L35) · [mobile](../../apps/mobile/src/state/settings-store.ts#L94) |
| `create_profile` | DM | DM | [desktop](../../apps/desktop/src/features/profiles/hooks/use-profile-actions.ts#L121) · [mobile](../../apps/mobile/src/state/settings-store.ts#L99) |
| `set_active_profile` | DM | DM | [desktop](../../apps/desktop/src/features/profiles/hooks/use-profile-actions.ts#L103) · [mobile](../../apps/mobile/src/state/settings-store.ts#L104) |
| `set_profile_notes_root` | DM | DM | [desktop](../../apps/desktop/src/features/profiles/hooks/use-profile-actions.ts#L156) · [mobile](../../apps/mobile/src/state/settings-store.ts#L109) |
| `update_profile` | DM | D | [desktop](../../apps/desktop/src/features/profiles/hooks/use-profile-actions.ts#L132) |
| `delete_profile` | DM | D | [desktop](../../apps/desktop/src/features/profiles/hooks/use-profile-actions.ts#L143) |

### Настройки

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `update_profile_settings` | DM | DM | [desktop](../../apps/desktop/src/features/profiles/hooks/use-legacy-profile-sync-migration.ts#L60) · [mobile](../../apps/mobile/src/state/settings-store.ts#L69) |
| `update_app_config` | DM | DM | [desktop](../../apps/desktop/src/features/profiles/hooks/use-legacy-profile-sync-migration.ts#L44) · [mobile](../../apps/mobile/src/state/settings-store.ts#L160) |

### Бэкап и экспорт

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `create_profiles_backup_zip` | DM | M | [mobile](../../apps/mobile/src/screens/settings-screen.tsx#L197) |
| `export_profiles_to_documents` | DM | — | — |


## security

Оболочки: [Tauri/security.rs](../../apps/desktop/src-tauri/src/commands/security.rs), [UniFFI/security.rs](../../crates/type-ffi/src/security.rs).

### Состояние и доступ

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `get_security_state` | DM | DM | [desktop](../../apps/desktop/src/features/security/hooks/security-context.tsx#L47) · [mobile](../../apps/mobile/src/state/security-store.ts#L30) |
| `lock_security` | DM | DM | [desktop](../../apps/desktop/src/features/security/hooks/security-context.tsx#L120) · [mobile](../../apps/mobile/src/state/security-store.ts#L64) |
| `unlock_security` | DM | DM | [desktop](../../apps/desktop/src/features/security/hooks/security-context.tsx#L85) · [mobile](../../apps/mobile/src/state/security-store.ts#L39) |

### Настройка защиты

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `enable_security` | DM | D | [desktop](../../apps/desktop/src/features/security/hooks/security-context.tsx#L66) |
| `set_security_preferences` | DM | D | [desktop](../../apps/desktop/src/features/security/hooks/security-context.tsx#L135) |


## recordings

Оболочки: [Tauri/recordings.rs](../../apps/desktop/src-tauri/src/commands/recordings.rs), [UniFFI/recordings.rs](../../crates/type-ffi/src/recordings.rs).

### Аудио и кэш

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `save_audio_recording` | DM | DM | [desktop](../../apps/desktop/src/features/recording/hooks/recordings-context.tsx#L184) · [mobile](../../apps/mobile/src/ui/dictation-button.tsx#L190) |
| `list_recordings` | DM | D | [desktop](../../apps/desktop/src/features/recording/hooks/recordings-context.tsx#L64) |
| `read_recording_audio` | DM | M | [mobile](../../apps/mobile/src/ui/audio-player.tsx#L48) |
| `resolve_recording_audio_path` | D | D | [desktop](../../apps/desktop/src/features/recording/hooks/recordings-context.tsx#L88) |
| `prune_mobile_audio_cache` | M | M | [mobile](../../apps/mobile/src/state/sync-store.ts#L393) |

### Транскрипция

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `queue_recording_transcriptions` | DM | DM | [desktop](../../apps/desktop/src/features/recording/hooks/recordings-context.tsx#L116) · [mobile](../../apps/mobile/src/ui/dictation-button.tsx#L199) |
| `queue_local_transcriptions` | D | D | [desktop](../../apps/desktop/src/features/recording/hooks/recordings-context.tsx#L118) |
| `queue_provider_transcriptions` | M | M | [mobile](../../apps/mobile/src/ui/dictation-button.tsx#L205) |
| `retrigger_transcription` | D | D | [desktop](../../apps/desktop/src/features/recording/hooks/recordings-context.tsx#L147) |
| `check_whisper_status` | D | D | [desktop](../../apps/desktop/src/features/settings/components/desktop/whisper-engine-card.tsx#L26) |

### Импорт аудио

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `import_audio_files` | D | D | [desktop](../../apps/desktop/src/features/recording/hooks/use-audio-import.ts#L103) |
| `audio_import_status` | D | D | [desktop](../../apps/desktop/src/features/recording/hooks/use-audio-import.ts#L50) |


## handwriting

Оболочки: [Tauri/handwriting.rs](../../apps/desktop/src-tauri/src/commands/handwriting.rs), [UniFFI/handwriting.rs](../../crates/type-ffi/src/handwriting.rs).

### Вложения

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `save_handwriting_attachment` | DM | DM | [desktop](../../apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx#L174) · [mobile](../../apps/mobile/src/ui/dictation-button.tsx#L284) |

### OCR

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `queue_handwriting_ocr` | D | D | [desktop](../../apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx#L146) |
| `list_handwriting_ocr_jobs` | D | D | [desktop](../../apps/desktop/src/features/handwriting/hooks/handwriting-context.tsx#L104) |
| `check_local_ocr_status` | D | D | [desktop](../../apps/desktop/src/features/settings/components/desktop/local-ocr-engine-card.tsx#L31) |


## import

Оболочки: [Tauri/import.rs](../../apps/desktop/src-tauri/src/commands/import.rs).

### Импорт Apple Notes

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `scan_apple_notes_folder` | D | D | [desktop](../../apps/desktop/src/features/import/hooks/use-apple-import.ts#L112) |
| `start_apple_notes_import` | D | D | [desktop](../../apps/desktop/src/features/import/hooks/use-apple-import.ts#L128) |
| `apple_import_status` | D | D | [desktop](../../apps/desktop/src/features/import/hooks/use-apple-import.ts#L58) |


## git_sync

Оболочки: [Tauri/git_sync.rs](../../apps/desktop/src-tauri/src/commands/git_sync.rs), [UniFFI/git_sync.rs](../../crates/type-ffi/src/git_sync.rs).

### SSH-ключи

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `generate_ssh_key` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-ssh-key.ts#L51) · [mobile](../../apps/mobile/src/screens/sync-screen.tsx#L402) |
| `get_ssh_public_key` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-ssh-key.ts#L36) · [mobile](../../apps/mobile/src/screens/sync-screen.tsx#L93) |
| `delete_ssh_key` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-ssh-key.ts#L67) · [mobile](../../apps/mobile/src/screens/sync-screen.tsx#L390) |

### Состояние и история

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `get_git_status` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts#L55) · [mobile](../../apps/mobile/src/state/sync-store.ts#L421) |
| `get_git_sync_progress` | DM | M | [mobile](../../apps/mobile/src/state/sync-store.ts#L288) |
| `get_git_history` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts#L70) · [mobile](../../apps/mobile/src/state/sync-store.ts#L293) |

### Подключение и обмен

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `connect_git_repo` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts#L93) · [mobile](../../apps/mobile/src/state/sync-store.ts#L263) |
| `git_pull` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts#L145) · [mobile](../../apps/mobile/src/state/sync-store.ts#L425) |
| `git_commit` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts#L183) · [mobile](../../apps/mobile/src/state/sync-store.ts#L648) |
| `git_push` | DM | DM | [desktop](../../apps/desktop/src/features/sync/hooks/use-git-sync-workflows.ts#L219) · [mobile](../../apps/mobile/src/state/sync-store.ts#L467) |


## local_sync

Оболочки: [Tauri/local_sync.rs](../../apps/desktop/src-tauri/src/commands/local_sync.rs), [UniFFI/iroh_sync.rs](../../crates/type-ffi/src/iroh_sync.rs).

### Desktop-сервер

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `get_local_sync_server_status` | D | D | [desktop](../../apps/desktop/src/features/sync/hooks/use-local-sync-server.ts#L35) |
| `start_local_sync_server` | D | D | [desktop](../../apps/desktop/src/features/sync/hooks/use-local-sync-server.ts#L65) |
| `stop_local_sync_server` | D | D | [desktop](../../apps/desktop/src/features/sync/hooks/use-local-sync-server.ts#L64) |
| `discover_local_sync_servers` | D | — | — |

### Mobile / Iroh

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `start_iroh_sync_client` | M | M | [mobile](../../apps/mobile/src/state/sync-store.ts#L132) |
| `iroh_client_status` | M | M | [mobile](../../apps/mobile/src/state/sync-store.ts#L216) |

### Перенос аудио

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `archive_mobile_audio_with_iroh` | M | M | [mobile](../../apps/mobile/src/state/sync-store.ts#L175) |
| `set_mobile_audio_git_exclusion` | M | M | [mobile](../../apps/mobile/src/state/sync-store.ts#L155) |


## tag_registry

Оболочки: [Tauri/tag_registry.rs](../../apps/desktop/src-tauri/src/commands/tag_registry.rs), [UniFFI/tag_registry.rs](../../crates/type-ffi/src/tag_registry.rs).

### Справочник тегов

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `read_tag_registry` | DM | D | [desktop](../../apps/desktop/src/features/tags/hooks/tags-context.tsx#L23) |
| `write_tag_registry` | DM | D | [desktop](../../apps/desktop/src/features/tags/hooks/tags-context.tsx#L39) |


## shell

Оболочки: [Tauri/app_icon.rs](../../apps/desktop/src-tauri/src/commands/app_icon.rs), [UniFFI/lib.rs](../../crates/type-ffi/src/lib.rs).

### Служебные функции

| Функция | API | Вызовы | Пример места использования |
|---|---|---|---|
| `set_app_icon` | D | D | [desktop](../../apps/desktop/src/app/state/app-icon-store.tsx#L36) |
| `init_core` | M | M | [mobile](../../apps/mobile/src/core/boot.ts#L39) |

## Обратный вызов: TranscriptionProvider

Помимо свободных функций, UniFFI экспортирует foreign trait
[TranscriptionProvider](../../crates/type-ffi/src/recordings.rs). Его реализует host,
а Rust вызывает `id()` и `transcribe(audio_path)`. Эти два метода не входят в
счётчик 52 функций UniFFI и 70 уникальных имён. `queue_provider_transcriptions`
принимает реализацию этого контракта.

## Как обновлять

1. Сверить desktop с `generate_handler![]` в `commands/mod.rs`, а mobile — с
   функциями под `#[uniffi::export]` в `crates/type-ffi/src`.
2. Обновить платформенные API-обёртки и найти их потребителей в `apps/*/src`;
   не считать определение обёртки использованием. Для «—» повторить поиск
   snake_case-команды и camelCase-имени, включая aliases / namespace imports.
3. Обновить подгруппы, таблицы, оба подробных Mermaid-исходника и их счётчики.
4. Проверить, что каждое имя встречается в каталоге и каждой схеме ровно один раз.
   Для текущего снимка: `63 + 52 - 45 = 70`.

Сверка существующего FFI-контракта: `node scripts/check-ffi-surface.mjs`.
Ссылки на строки — ориентиры данного снимка; при изменениях ориентироваться
на имя символа и файл.
