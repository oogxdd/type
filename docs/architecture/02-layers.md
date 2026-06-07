# 02. Слои проекта простыми словами

Backend сейчас устроен так:

```text
src-tauri/src/
  domain/
  application/
  ports/
  adapters/
  commands/
```

Можно думать об этом как о пяти разных ролях в команде.

## `commands/`: входная дверь

Файлы: `src-tauri/src/commands/*.rs`

Это Tauri IPC слой. Он похож на controller в Express/Nest/Rails:

- принять аргументы от frontend;
- проверить lock/security gate;
- вызвать нужный use case;
- иногда отправить тяжелую работу в blocking thread;
- вернуть DTO обратно.

Command не должен сам решать, как создать заметку или как сделать Git pull.
Он только проводит запрос внутрь системы.

Пример:

```rust
#[tauri::command]
pub(super) fn read_note(app: tauri::AppHandle, path: String) -> Result<String, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.read_note(&path)
}
```

Это хороший command: мало логики, понятная граница.

## `application/`: сценарии приложения

Файлы: `src-tauri/src/application/*.rs`

Здесь живут use cases:

- `create_note`;
- `write_note`;
- `move_items`;
- `git_pull`;
- `queue_handwriting_ocr`;
- `start_apple_notes_import`.

Application слой отвечает на вопрос:

> Что должно произойти с точки зрения приложения?

Например, при создании заметки:

- выбрать папку;
- запретить storage folders;
- создать id;
- выбрать имя файла;
- создать frontmatter;
- записать заметку;
- обновить порядок папки.

Но application не должен знать, как именно работает `std::fs` или Tauri app data.

## `domain/`: язык предметной области

Файлы: `src-tauri/src/domain/*.rs`

Сейчас туда вынесены note-типы:

- `FolderNode`;
- `NoteEntry`;
- `NoteMeta`;
- `NoteFrontMatter`;
- `CreateNoteArgs`;
- `CreateNoteResult`;
- `NoteFileNameFormat`.

Domain — это словарь приложения. Он не должен зависеть от Tauri, файловой
системы, HTTP или Git.

## `ports/`: контракты

Файлы: `src-tauri/src/ports/*.rs`

Port — это trait, который говорит:

> Application слою нужна вот такая возможность, но ему не важно, кто именно ее даст.

Пример из notes:

```rust
pub(crate) trait NoteBodyCrypto {
    fn decrypt_note_body(&self, body: &str) -> Result<String, String>;
}
```

Application знает: "мне нужно расшифровать body". Но он не знает про
`XChaCha20Poly1305`, runtime key, lock state и т.п.

## `adapters/`: реальный мир

Файлы: `src-tauri/src/adapters/*.rs` и папки внутри `adapters/`

Adapter реализует port через конкретную технологию:

- filesystem repository;
- frontmatter parser;
- security runtime;
- `git2`;
- `reqwest`;
- Tauri app data;
- iOS Objective-C interop.

Например:

```rust
impl NoteBodyCrypto for RuntimeNoteBodyCrypto {
    fn decrypt_note_body(&self, body: &str) -> Result<String, String> {
        crate::decrypt_note_body_for_read(body)
    }
}
```

## Почему не все одинаково строго

Notes сделаны строже всех: там реальный workflow вынесен в `application/notes.rs`
и зависит от granular ports.

Другие домены пока используют gateway traits: command вызывает application
facade, facade вызывает adapter gateway. Это менее академично, но прагматично:
мы быстро убрали workflow из command layer, не переписывая все очереди,
native APIs и Git internals за один раз.

Это нормальный путь: архитектуру можно улучшать постепенно.
