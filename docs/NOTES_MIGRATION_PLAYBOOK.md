# Notes Migration Playbook (Feed/Recordings + UTC filenames)

Этот файл описывает все миграции, которые были сделаны, чтобы повторить их в другом репозитории.

## 1) Целевое состояние

- Системные папки в `notes_root`:
  - `Feed` (дефолтная папка заметок, без `.notes-order.json`)
  - `Archieve` (именно с этой опечаткой)
  - `Recordings` (хранилище аудио)
- Legacy-папки удалены:
  - `Unsorted` -> `Feed`
  - `_Recordings` -> `Recordings`
- Запись аудио:
  - аудиофайл хранится в `Recordings/...`
  - заметка (в `Feed` или выбранной папке) содержит frontmatter `type: audio_recording` + `recording_audio_path: ...`
- Имена заметок:
  - `YYYY-MM-DDTHH-mm-ssZ-<slug>.md` (UTC)
- Frontmatter:
  - `id` остаётся UUIDv7
  - `created_ms`, `updated_ms` присутствуют
- Пустые заметки удалены (включая заметки, где только пустые строки/`NV_EMPTY_LINE_TOKEN_*`).

## 2) Изменения в коде приложения

Перед прогоном миграций в данных нужно иметь эти изменения в коде:

### Backend (Rust)

Файл: `src-tauri/src/lib.rs`

- `create_note` создаёт файл с timestamp-именем UTC вместо UUID filename.
- `save_audio_recording` создаёт recording-note с timestamp-именем UTC.
- `meta.id` остаётся отдельным UUIDv7 (`generate_note_id()`).
- `slug_from_content(...)`:
  - Unicode-aware (кириллица/латиница/цифры).
  - игнорирует шум `NV_EMPTY_LINE_TOKEN_*`.
  - режет slug до 56 символов и 8 слов.

### Frontend (TS)

Файл: `src/hooks/useNoteEditor.ts`

- Авто-переименование поддерживает timestamp-файлы.
- Placeholder suffix (`-note`, `-untitled`) меняется на нормальный slug.
- Slug extraction:
  - Unicode-aware.
  - фильтрация `NV_EMPTY_LINE_TOKEN_*`.

### Документация

- Обновлён `AGENTS.md`/`agents.md` в части filename lifecycle и slug behavior.

## 3) Скрипты миграции данных

Скрипты (из этого репо):

- `scripts/migrate-notes-format.cjs`
- `scripts/migrate-note-filenames-utc.cjs`
- `scripts/delete-empty-notes.cjs`

Все скрипты поддерживают `--root <path>` и dry-run без `--apply`.
Все скрипты делают бэкап в `notes/.migration-backups/...` перед записью.

## 4) Порядок миграции (для старого legacy-формата)

Запускать из корня приложения.

### Шаг A. Базовая структурная миграция (legacy -> modern)

```bash
node scripts/migrate-notes-format.cjs --root /ABS/PATH/TO/notes
node scripts/migrate-notes-format.cjs --root /ABS/PATH/TO/notes --apply
```

Что делает:

- Переносит `Unsorted` в `Feed`.
- Переносит `_Recordings/*` в `Recordings/*`.
- Обновляет `recording_audio_path` в заметках.
- Создаёт frontmatter там, где отсутствует:
  - UUIDv7 `id`
  - `created_ms`, `updated_ms`
- Обрабатывает legacy `Recordings/recording-<ts>/...`:
  - переносит аудио в `Recordings/audio-<id>.<ext>`
  - создаёт note-файл с frontmatter `audio_recording`.
- Удаляет `Feed/.notes-order.json`.

Примечание: этот скрипт даёт промежуточные filename вида `<uuid-prefix>-<slug>.md`.

### Шаг B. Конвертация filename в UTC формат

```bash
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes --apply
```

Что делает:

- Переименовывает заметки в `YYYY-MM-DDTHH-mm-ssZ-<slug>.md`.
- Timestamp берётся в приоритете:
  - `created_ms` -> `updated_ms` -> `mtime`.
- Обновляет `.notes-order.json` в папках, где он есть.

### Шаг C. Доп. прогон только для placeholder-имён

Использовать после фикса slug-алгоритма (Unicode + фильтр noise), чтобы добить `*-note.md` / `*-untitled.md`:

```bash
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes --placeholder-only
node scripts/migrate-note-filenames-utc.cjs --root /ABS/PATH/TO/notes --placeholder-only --apply
```

### Шаг D. Удаление пустых заметок

```bash
node scripts/delete-empty-notes.cjs --root /ABS/PATH/TO/notes
node scripts/delete-empty-notes.cjs --root /ABS/PATH/TO/notes --apply
```

Пустой считается note body, где после удаления whitespace и `NV_EMPTY_LINE_TOKEN_*` ничего не остаётся.

## 5) Проверки после миграции

### 5.1 Нет legacy-папок/файлов

- нет `Unsorted/`
- нет `_Recordings/`
- нет `Feed/.notes-order.json`

### 5.2 Имена файлов в UTC-формате

Проверить, что `.md` соответствуют паттерну:

`YYYY-MM-DDTHH-mm-ssZ-<slug>.md`

### 5.3 Нет пустых заметок

Повторный dry-run:

```bash
node scripts/delete-empty-notes.cjs --root /ABS/PATH/TO/notes
```

Ожидание: `"deleted": 0`.

### 5.4 Нет orphan-аудио

Проверка, что каждый файл в `Recordings` referenced из `recording_audio_path`, и нет битых ссылок:

```bash
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const root = '/ABS/PATH/TO/notes';
const recordingsDir = path.join(root, 'Recordings');
const audioExtRe = /\.(m4a|mp3|wav|ogg|flac|webm)$/i;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function parseFrontMatter(raw) {
  if (!raw.startsWith('---\n')) return {};
  const close = raw.indexOf('\n---\n', 4);
  if (close === -1) return {};
  const meta = {};
  for (const line of raw.slice(4, close).split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]+):\s*(.*)\s*$/);
    if (!m) continue;
    meta[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return meta;
}

function walkNotes(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.migration-backups') continue;
      walkNotes(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const audioFiles = walk(recordingsDir)
  .filter((p) => audioExtRe.test(p))
  .map((p) => path.relative(root, p).replace(/\\/g, '/'));
const referenced = new Set();
for (const notePath of walkNotes(root)) {
  const raw = fs.readFileSync(notePath, 'utf8');
  const meta = parseFrontMatter(raw);
  const rel = (meta.recording_audio_path || '').trim();
  if (rel) referenced.add(rel.replace(/^\/+/, '').replace(/\\/g, '/'));
}
const orphans = audioFiles.filter((rel) => !referenced.has(rel));
const missing = [...referenced].filter((rel) => !audioFiles.includes(rel));
console.log(JSON.stringify({
  audio_files_total: audioFiles.length,
  referenced_audio_paths_total: referenced.size,
  orphan_audio_files_count: orphans.length,
  missing_audio_files_count: missing.length
}, null, 2));
NODE
```

Ожидание: оба count равны `0`.

## 6) Безопасность/откат

- Каждый скрипт перед записью складывает копии в `notes/.migration-backups/<migration-name>-<timestamp>/`.
- Для отката можно восстановить файлы из соответствующего backup-dir.

## 7) Что было применено в этом проекте

- Переведена структура папок на `Feed` / `Archieve` / `Recordings`.
- Мигрированы ссылки и legacy recording layout.
- Нормализован frontmatter (UUIDv7 `id`, `created_ms`, `updated_ms`).
- Filename переведены в UTC timestamp-формат.
- Slug generation обновлён на Unicode-aware и noise-safe.
- Пустые заметки удалены.
- Проверено: orphan-аудио нет, битых `recording_audio_path` нет.

