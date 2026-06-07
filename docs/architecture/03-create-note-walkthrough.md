# 03. Пример: путь команды `create_note`

Лучший способ понять архитектуру — пройти один запрос от frontend до диска.
Возьмем создание заметки.

## 1. Frontend вызывает IPC

Frontend вызывает Tauri command `create_note` через API wrapper:

```text
src/features/notes/api/notes-api.ts
```

Для Rust backend это входной запрос:

```text
"create_note" + args
```

## 2. Command слой: только вход и security gate

Файл:

```text
src-tauri/src/commands/notes.rs
```

Command делает три вещи:

```rust
#[tauri::command]
pub(super) fn create_note(
    app: tauri::AppHandle,
    args: CreateNoteArgs,
) -> Result<CreateNoteResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.create_note(args)
}
```

Что здесь важно:

- Tauri-specific `AppHandle` остается на краю.
- Lock check происходит на boundary.
- Сам workflow не здесь.

## 3. Application слой: сценарий создания заметки

Файл:

```text
src-tauri/src/application/notes.rs
```

Тут живет смысл операции:

```rust
pub(crate) fn create_note(&self, args: CreateNoteArgs) -> Result<CreateNoteResult, String> {
    self.repository.ensured_root()?;
    let folder_rel = args.folder_path ... unwrap_or(FEED_FOLDER);
    let folder_full = self.repository.resolve_path(folder_rel)?;

    if self.repository.is_storage_folder_path(&folder_full) {
        return Err("Notes cannot be created inside recordings or attachments storage.".to_string());
    }

    ...
}
```

Это уже не "как Tauri вызывает Rust". Это бизнес-сценарий:

- гарантировать notes root;
- выбрать папку;
- запретить storage folders;
- создать директорию;
- сгенерировать note id;
- выбрать filename;
- собрать frontmatter;
- записать note;
- обновить order file, если это не Feed.

## 4. Ports: application просит возможности

Application не вызывает `fs::write` напрямую. Вместо этого он говорит:

```rust
self.repository.write_note(&path, &meta, &content)?;
```

`repository` — это trait из:

```text
src-tauri/src/ports/notes.rs
```

То есть application знает не "файловая система", а "хранилище заметок".

## 5. Adapter: конкретная реализация через filesystem

Файл:

```text
src-tauri/src/adapters/notes/mod.rs
```

Там есть:

```rust
pub(crate) struct FilesystemNotesRepository {
    root: PathBuf,
}
```

И реализация:

```rust
impl NotesRepository for FilesystemNotesRepository {
    fn write_note(&self, path: &Path, meta: &NoteFrontMatter, body: &str) -> Result<(), String> {
        write_note_with_front_matter(path, meta, body)
    }
}
```

Вот здесь уже нормально знать про filesystem, frontmatter file format и реальные
пути на диске.

## Что мы выиграли

Если завтра нужно будет хранить заметки не в `.md` файлах, а в SQLite, главный
workflow `create_note` можно оставить похожим. Нужно будет заменить adapter,
который реализует `NotesRepository`.

Если нужно протестировать `create_note`, можно сделать fake repository без
реального диска.

Если нужно перенести backend из Tauri в другую оболочку, command layer можно
заменить, а application logic оставить.

## Главный урок

Не вся логика одинаковая.

```text
Проверить lock screen         -> command boundary
Запретить Recordings folder   -> application rule
Сгенерировать UUID            -> id port / adapter
Записать файл                 -> adapter
Сформировать NoteFrontMatter  -> domain/application
```

Архитектурное мышление начинается с умения различать эти категории.
