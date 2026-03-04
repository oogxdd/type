# Notes Data Migration (Only)

Только про миграцию данных. Без изменений кода приложения.

## Какие скрипты нужно заинклюдить в другое репо

Скопируй эти 3 файла:

1. `/Users/digital/Projects/type/app/scripts/migrate-notes-format.cjs`
2. `/Users/digital/Projects/type/app/scripts/migrate-note-filenames-utc.cjs`
3. `/Users/digital/Projects/type/app/scripts/delete-empty-notes.cjs`

## Что делает каждый скрипт

1. `migrate-notes-format.cjs`
- Legacy структура -> новая:
  - `Unsorted` -> `Feed`
  - `_Recordings` -> `Recordings`
- Нормализует frontmatter (`id`, `created_ms`, `updated_ms`)
- Мигрирует legacy recording folder layout
- Удаляет `Feed/.notes-order.json`

2. `migrate-note-filenames-utc.cjs`
- Переименовывает заметки в формат:
  - `YYYY-MM-DDTHH-mm-ssZ-<slug>.md` (UTC)
- Обновляет `.notes-order.json` при rename
- Есть режим `--placeholder-only` (только `*-note.md`/`*-untitled.md` и legacy UUID names)

3. `delete-empty-notes.cjs`
- Удаляет пустые заметки (включая случаи, где только пустые строки / `NV_EMPTY_LINE_TOKEN_*`)
- Обновляет `.notes-order.json` при необходимости

## Порядок запуска

Все команды запускать из корня проекта.
`--apply` только после dry-run.

### 1) Базовая структурная миграция

```bash
node scripts/migrate-notes-format.cjs --root /ABS/PATH/TO/notes
node scripts/migrate-notes-format.cjs --root /ABS/PATH/TO/notes --apply
```

### 2) Переименование в UTC filename

```bash
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes --apply
```

### 3) Добить только placeholder-имена (опционально, но рекомендовано)

```bash
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes --placeholder-only
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes --placeholder-only --apply
```

### 4) Удаление пустых заметок

```bash
node scripts/delete-empty-notes.cjs --root /ABS/PATH/TO/notes
node scripts/delete-empty-notes.cjs --root /ABS/PATH/TO/notes --apply
```

## Минимальные проверки после миграции

1. Нет legacy папок:
- `Unsorted` отсутствует
- `_Recordings` отсутствует

2. Нет `Feed/.notes-order.json`

3. Повторный dry-run на пустые заметки:

```bash
node scripts/delete-empty-notes.cjs --root /ABS/PATH/TO/notes
```

Ожидание: `"deleted": 0`

## Бэкапы

Каждый скрипт перед записью создаёт бэкап в:

`/ABS/PATH/TO/notes/.migration-backups/<migration-name>-<timestamp>/`

