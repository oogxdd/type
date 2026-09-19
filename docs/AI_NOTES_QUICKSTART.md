# Быстрый запуск Codex с заметками

1. В корне репозитория: `npm run mcp:build`.
2. Добавьте MCP в `~/.codex/config.toml` (замените путь к заметкам):

```toml
[mcp_servers.notes]
command = "node"
args = ["/Volumes/KINGSTON/Projects/type/app/apps/notes-mcp/dist/main.mjs", "--notes-root", "/ABSOLUTE/PATH/TO/NOTES"]
```

Если сервер notes уже добавлен, обновите существующий раздел. Если раньше был
`enabled_tools` с тремя методами, удалите эту строку для доступа к новым методам.
Сервер сам ограничивает запись папкой `<notes-root>/_system/agent`.

3. Запустите из отдельной рабочей папки, например `~/notes-agent`:

```bash
mkdir -p ~/notes-agent
cd ~/notes-agent
# MCP, без терминала и поиска:
codex -c features.shell_tool=false -c 'web_search="disabled"' --sandbox read-only
# Или MCP + веб-поиск:
codex -c features.shell_tool=false -c 'web_search="live"' --sandbox read-only
```

Отключите другие плагины/инструменты прямого чтения файлов: эти команды отключают
стандартный терминал, а не все возможные способы доступа. Sandbox read-only не
ограничивает отдельный процесс MCP; его запись ограничивает сам сервер.

4. Проверьте подключение через `/mcp`. Примеры запросов:

- «Прочитай заметки через notes и найди повторяющиеся мысли».
- «Проверь эту идею в интернете и сопоставь с моими заметками» (режим с поиском).
- «Создай ideas/plan.md в своей папке agent со своими предложениями».
- «Прочитай свою заметку, дополни и сохрани с актуальным revision».

`skip-ai` назначается абзацам через интерфейс тегов Type. Дождитесь сохранения.
МCP скрывает эти блоки, а при неразрешённой привязке отклоняет заметку.

Проверка без модели и без личных данных:

```bash
npm run mcp:test
npm run mcp:build
node scripts/test-notes-mcp.mjs
```

[Подробный гайд, Claude Code и ограничения](AI_NOTES_MCP.md).
