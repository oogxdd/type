# 06. Практика: как натренировать архитектурное мышление

Архитектура становится понятной не от чтения терминов, а от маленьких разборов.
Вот упражнения по этому проекту.

## Упражнение 1: найди слой

Для каждой операции реши, где ей место:

- проверить, что app unlocked;
- распарсить frontmatter;
- запретить создание заметки внутри `Recordings`;
- вызвать `git2::Repository::open`;
- выбрать default folder `Feed`;
- закодировать audio bytes в base64;
- вернуть `CreateNoteResult`;
- показать file export sheet на iOS.

Ответы:

- app unlocked — `commands` boundary / security adapter;
- frontmatter parsing — adapter через document codec;
- запрет `Recordings` — application rule;
- `git2::Repository::open` — adapter;
- default `Feed` — application/domain rule;
- base64 audio — adapter/edge DTO work;
- `CreateNoteResult` — domain DTO;
- iOS export sheet — platform adapter.

## Упражнение 2: прочитай vertical slice

Прочитай только эти файлы:

```text
src-tauri/src/commands/notes.rs
src-tauri/src/application/notes.rs
src-tauri/src/ports/notes.rs
src-tauri/src/adapters/notes/mod.rs
src-tauri/src/domain/notes.rs
```

Цель: объяснить самому себе, как работает `read_note` и `create_note`, не
открывая остальной backend.

Если получилось — ты понял главный архитектурный путь.

## Упражнение 3: нарисуй зависимости

Возьми `create_note` и нарисуй так:

```text
create_note
  needs notes root
  needs path sanitize
  needs filename allocation
  needs note id
  needs current time
  needs body encryption on write
  needs order update
```

Потом подпиши рядом:

```text
application rule или adapter detail?
```

Это учит отделять сценарий от реализации.

## Упражнение 4: придумай fake adapter

Представь, что нужно протестировать `create_note` без диска.

Какие методы fake repository должен хранить в памяти?

- список "существующих" путей;
- записанные notes;
- order updates;
- fake root;
- fake filename allocation.

Если ты можешь представить fake adapter, значит port выбран неплохо.

## Упражнение 5: улучши один gateway

Сейчас notes — самый строгий домен. Остальные домены используют gateway facade.

Попробуй мысленно сделать recordings строже:

- какие DTOs можно перенести в `domain/recordings.rs`?
- какие ports нужны для audio storage?
- какой port нужен для transcription queue?
- где должен жить выбор backend: AssemblyAI vs local Whisper?

Не обязательно сразу писать код. Архитектурный дизайн часто начинается с
разделения вопросов.

## Чеклист перед изменением backend

Перед тем как писать код:

- Я понимаю, какой use case меняю.
- Я знаю, где command boundary.
- Я знаю, какая часть является правилом приложения.
- Я знаю, какая часть является технической деталью.
- Я не добавляю абстракцию "на всякий случай".
- Я могу объяснить изменение одним vertical slice.

После изменения:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- docs обновлены, если поменялась архитектурная договоренность.

## Финальная мысль

Архитектура — это не набор папок. Папки только помогают.

Главное — уметь удерживать границы:

```text
что делает приложение
vs
как именно это делается сегодня
```

Когда ты начинаешь видеть эту разницу, ты становишься не просто человеком,
который пишет фичи, а разработчиком, который умеет строить системы.
