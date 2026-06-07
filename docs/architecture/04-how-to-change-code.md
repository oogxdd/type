# 04. Как вносить изменения без хаоса

Когда добавляешь новую backend-фичу, не начинай с вопроса "в какой файл это
быстрее вписать?". Начинай с вопроса:

> Что это за изменение: новый use case, новое правило, новый adapter или новый IPC endpoint?

## Типичный порядок работы

Допустим, нужно добавить "duplicate note".

### 1. Определи use case

Сценарий:

```text
duplicate_note(source_path, destination_folder?)
```

Что он должен делать:

- прочитать исходную заметку;
- сохранить body;
- создать новый id;
- выбрать filename;
- сохранить frontmatter;
- обновить порядок папки;
- вернуть новый path.

Это application logic.

### 2. Добавь типы в domain, если они являются языком приложения

Если нужен новый result:

```rust
pub struct DuplicateNoteResult {
    pub path: String,
}
```

Это может жить в `domain/notes.rs`, потому что это DTO предметной области.

### 3. Проверь ports

Нужна ли новая возможность?

Возможно, уже хватает:

- `read_to_string`;
- `write_note`;
- `allocate_note_file_name`;
- `update_order_append`.

Если хватает — не добавляй новые ports.

Если не хватает — добавь минимальный метод в trait.

### 4. Реализуй use case в application

Файл:

```text
src-tauri/src/application/notes.rs
```

Тут должно быть "что происходит", но не технические детали.

### 5. Реализуй adapter только если нужен новый внешний механизм

Например, если нужен новый способ читать metadata, это adapter.
Если нужен новый HTTP запрос, это adapter.
Если нужна новая native iOS операция, это adapter.

### 6. Добавь command

Файл:

```text
src-tauri/src/commands/notes.rs
```

Command должен быть коротким:

```rust
#[tauri::command]
pub(super) fn duplicate_note(
    app: tauri::AppHandle,
    args: DuplicateNoteArgs,
) -> Result<DuplicateNoteResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.duplicate_note(args)
}
```

## Как понять, что ты положил код не туда

Признаки:

- В `commands/` появился длинный workflow.
- В `application/` появился `tauri::AppHandle`.
- В `application/` появился прямой `fs::write`.
- В `domain/` появился `reqwest`, `git2`, `tauri`, `std::process::Command`.
- Adapter начал решать пользовательское правило, например "можно ли это делать".
- Один файл импортирует почти весь crate через `use crate::*` и потом сложно понять зависимости.

## Не надо делать "идеально"

Clean architecture легко превратить в бюрократию. В этом проекте цель проще:

- commands должны быть тонкими;
- важные workflows должны быть в application;
- внешние технологии должны быть в adapters;
- application должен зависеть от traits, когда это реально помогает;
- документация должна объяснять границы.

Если новая абстракция не упрощает тестирование, переносимость или понимание,
скорее всего она пока не нужна.

## Маленькое правило для PR review

При review backend-изменения задай четыре вопроса:

- Где находится use case?
- Где находится техническая деталь?
- Кто от кого зависит?
- Можно ли понять поведение, не читая Tauri command?

Если ответы ясные — архитектура, скорее всего, держится.
