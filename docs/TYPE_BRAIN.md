# Голосовой агент Type

Локальный голосовой экран соединяет `gpt-live-1` с brain на `gpt-6-luna`.
Brain опубликован как отдельный MCP-сервер (`run_personal_agent`) и получает
контекст через существующий Notes MCP. У Notes MCP остаются фильтрация `skip-ai`,
ограничение областей записи, ссылки и контроль версий источников.

```text
Браузер: микрофон ↔ GPT-Live (WebRTC)
                    ↓ client delegation
Type brain MCP → OpenAI Responses (gpt-6-luna)
              ↔ Notes MCP → stream / me / reviews / agent
```

GPT-Live ведёт речь. Brain обрабатывает делегированные запросы, загружает
`prepare_context` и при необходимости вызывает `read_note`, `read_document`,
`read_memory`, поиск, ссылки и операции памяти. Backend проверяет, что заявленные
источники были прочитаны в данном запросе; производные документы могут быть
зависимостью с `role:"context"`. Brain сохраняет обоснованные обновления через
`write_memory` и `save_artifact`. Обзорам нужны явные период и часовой пояс.

## Запуск

Нужны Node 22.13+, API-ключ проекта OpenAI с доступом к GPT-Live и
`gpt-6-luna`, а также путь к **корню заметок**. Ключ передаётся через
`OPENAI_API_KEY` в окружении процесса; он не попадает в браузер или в Markdown.

```bash
npm install
npm run mcp:build
export OPENAI_API_KEY=...  # установите локально, не записывайте ключ в репозиторий
npm run brain:start -- --notes-root /absolute/path/to/notes --voice
```

Откройте напечатанный адрес `http://127.0.0.1:4307/`. Нажмите «Начать голосовой
разговор» и разрешите микрофон. Есть поле для текстового сообщения через тот же
brain. Выберите режим разговора/обзора и размер summary; для обзора назовите
период и часовой пояс. Переключатель «Разрешить обновлять память» действует на следующие запросы;
прямая просьба «не сохраняй» блокирует записи и при включённом переключателе.
Экран и HTTP API слушают только `127.0.0.1`, принимают запросы из своего origin.
При завершении отправляется `session.close`, а экран ждёт `session.closed`.

Чтобы перейти на другую модель анализа:

```bash
npm run brain:start -- --notes-root /absolute/path/to/notes --voice --brain-model gpt-6-sol
```

Также можно задать `TYPE_BRAIN_MODEL=gpt-6-sol`. При смешанной старой и новой
раскладке укажите `--layout legacy` или `--layout system`; запуск не мигрирует
файлы. Порт меняется через `--port`.

После сборки `npm run brain:smoke` проверяет настоящий stdio MCP-процесс на
пустом временном корне без обращения к OpenAI.

## Подключение brain MCP напрямую

Brain работает по stdio без `--voice`:

```text
command: node
args: /absolute/path/to/repo/apps/notes-mcp/dist/brain.mjs --notes-root /absolute/path/to/notes
env: OPENAI_API_KEY=<key>
```

Инструмент `run_personal_agent` принимает `request`, `mode`
(`conversation`, `review`, `observation`, `morning_note`), `summarySize`,
необязательную короткую `history` и `allowWrites`. Для review укажите границы,
часовой пояс и фактическое покрытие в запросе. Ответ содержит текст, модель и
использованные инструменты. Точная рецептура контекста для разных обзоров всё
ещё выбирается отдельно.

## Текущие границы

- Голосовой экран работает локально в браузере; он ещё не встроен в Tauri/Expo.
- История произнесённых фраз живёт только в открытой странице. Полезные выводы
  сохраняются лишь если агент решит вызвать операцию памяти.
- Нет фонового расписания. Reviews и summaries возникают по запросу.
- `gpt-live-1` требует доступа к Live API. Без рабочего ключа проверить
  настоящий микрофон → OpenAI → ответ невозможно; кодовые тесты используют
  синтетические заметки и поддельные ответы API.
- Notes MCP не читает зашифрованные заметки. Личный текст, который brain
  выбирает прочесть, передаётся в OpenAI Responses; голос идёт в GPT-Live.

API-основание: [GPT-Live](https://developers.openai.com/api/docs/guides/live),
[client delegation](https://developers.openai.com/api/docs/guides/live-delegation),
[WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live),
[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
