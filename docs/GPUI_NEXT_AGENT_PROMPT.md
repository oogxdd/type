Продолжи миграцию Type с Tauri на GPUI в существующем ворктри:
`/Volumes/KINGSTON/Projects/type/app/.worktrees/gpui-desktop`, ветка `codex/gpui-desktop`.
Не работай в основном checkout и не создавай новый ворктри поверх текущего прогресса.

Сначала прочитай `AGENTS.md`, `docs/GPUI_MIGRATION_STATUS.md` и `apps/gpui/README.md`.
Проверь git status/log: предыдущий агент закоммитил и запушил текущий прогресс.

Приоритет — функциональность и хоткеи. UI и feel пользователь тестирует сам;
не делай visual review и не трогай открытое dev-окно без необходимости.
Полный Tiptap не нужен. Размер H1/H2/H3 пока не реализовывать.

Уже есть native shell над type-core, минимальный layout, Stream/Folders,
Ctrl+W между pane, Tab только в nav, Vim-курсоры, line numbers и группированная
Cmd+K с закрытием по outside click без click-through. 33 native теста прошли.
Сборка и запуск dev bundle на synthetic playground прошли.

Продолжай по списку remaining в handoff: дополнительные функциональные проверки,
сохранение раскрытых папок между views, сохранность записи при ошибке и retry,
автоматические processing queues, профильные операции и валидация настроек,
затем сборка/CI/release cutover. Не считай выставленные команды проверенными
сетевыми/микрофонными сценариями: они пока не прогнаны end-to-end.

Используй только synthetic fixtures. Не открывай production notes. Коммить
изменения по этапам, обновляй handoff, затем push в эту ветку. PR, merge и
публикация релиза не запрошены. Команды и путь к тёплому Cargo cache — в handoff.
