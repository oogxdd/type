# 05. Мостик из React/Node в backend-архитектуру

Если ты в основном приходишь из React и немного Node, clean architecture может
звучать чуждо. На самом деле идеи знакомые.

## React аналогия

Плохой React-компонент:

```tsx
function NotesButton() {
  // state
  // fetch
  // parsing
  // localStorage
  // routing
  // rendering
  // permissions
}
```

Такой компонент работает, но его трудно менять.

Обычно ты выносишь:

- UI в component;
- state в hook/store;
- API calls в api module;
- pure helpers в lib;
- orchestration в feature hook.

Backend слои делают похожее:

```text
component      ~ commands
feature hook   ~ application
types/helpers  ~ domain
api interface  ~ ports
fetch/storage  ~ adapters
```

Аналогия не идеальная, но полезная.

## Node/Express аналогия

В Express можно написать:

```ts
app.post("/notes", async (req, res) => {
  const root = await getProfileRoot(req.user)
  const filename = makeFilename(req.body.content)
  await fs.writeFile(path.join(root, filename), req.body.content)
  res.json({ path: filename })
})
```

Для маленького проекта нормально. Для растущего проекта лучше:

```text
route/controller -> service/use-case -> repository interface -> fs repository
```

В Rust backend Type это выглядит так:

```text
commands/notes.rs
  -> application/notes.rs
    -> ports/notes.rs
      -> adapters/notes/mod.rs
```

## Что такое port простыми словами

Port — это "мне нужна возможность, но мне не важно, кто ее даст".

В TypeScript это было бы примерно:

```ts
type NotesRepository = {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
}
```

Use case:

```ts
async function createNote(repo: NotesRepository, args: CreateNoteArgs) {
  // business workflow
  await repo.write(...)
}
```

Adapter:

```ts
const fsNotesRepository: NotesRepository = {
  read: (path) => fs.promises.readFile(path, "utf8"),
  write: (path, content) => fs.promises.writeFile(path, content),
}
```

В Rust trait играет похожую роль.

## Почему Rust делает это заметнее

В TypeScript можно легко "случайно" импортировать что угодно. Rust тоже
позволяет смешать слои, но типы и traits сильнее подталкивают к явным границам.

Например:

```rust
pub(crate) trait NoteClock {
    fn now_ms(&self) -> Option<i64>;
}
```

Это выглядит мелко, но идея важная: use case не должен сам ходить в system time,
если мы хотим контролировать время в тестах.

## Главное отличие от frontend

На frontend часто основная сложность — состояние UI и взаимодействия.
На backend основная сложность — долговечность данных, side effects и правила.

Поэтому backend-архитектура особенно заботится о вопросах:

- где side effect;
- где правило;
- можно ли протестировать правило без side effect;
- что будет, если заменить технологию.

Это и есть мышление, которое делает разработчика сильнее в системном дизайне.
