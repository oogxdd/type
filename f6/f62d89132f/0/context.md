# Session Context

## User Prompts

### Prompt 1

хочу сделать ноывй релиз

1) скажи какие ветки локал/ремоут осталиьс несмержнутые
2) по коммитам определи что в целом изменилось с последнего релиза (необязательно полынй список, просто основные моменты)
3) пойми сможешь ли ты замутить релиз (либо локально либо через git runner чтобы по ad-hoc на моем айфоне обновилось (ну либо чтоб я по ссылке зашел и обновил))

### Prompt 2

[Request interrupted by user for tool use]

### Prompt 3

подожди. я хочу бэклог сделать (но не чисто технический а просто обозначить в общих чертах что изменилось с последней версии (или последней тэгнутого релиза - не знаю)

### Prompt 4

короче дай

1. bug:improve geastures (describe which geastures)
2. bug:debug sync bugs. improve sync ui (still button-press based)
3. feat:be able to "commit" local changes any time you want (act as checkpoint)
4. feat:custom (customizable) appearence
5. chore:diagnostics tab
6: " - Отклоняются повреждённые/незавершённые аудиозаписи (m4a) — чтобы битый файл не портил транскрипцию." - ченибудь чуть потробнее про это. кажется это ломакало синк. возможно как баг фикс (а возможно внутри синк багс...

### Prompt 5

nah. in english literally in the same stylistics

  1. bug:improve geastures (describe which geastures)
  2. bug:debug sync bugs. improve sync ui (still button-press based)
  3. feat:be able to "commit" local changes any time you want (act as checkpoint)
  4. feat:custom (customizable) appearence
  5. chore:diagnostics tab
     6: " - Отклоняются повреждённые/незавершённые аудиозаписи (m4a) — чтобы битый файл не портил транскрипцию." - ченибудь чуть потробнее про это. кажется это ломакало син...

### Prompt 6

dude. i said in literally same kind of typing as above. eg i dont care about this shit:

Fixed a crash (SIGABRT) on a fast swipe-up, and reworked the
     recognizer so the file gesture no longer fights the OS's edge-swipe-back gesture.


(it can be generally extracted from commit names)

### Prompt 7

cause i make it people facing and not "techy geeky shit generated with ai noone really cares about". if people want to get on full comprehensive technical log - i will maintain it separately later

### Prompt 8

/compact

### Prompt 9

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
   The user (writing primarily in Russian and English, mixed) wanted to prepare a new release of the "type" app (a local-first markdown notes app with a Tauri desktop app and a React Native mobile app sharing one Rust core, per AGENTS.md/CLAUDE.md). The explicit, evolving requests were:
   
   a) **Orig...

### Prompt 10

Continue from where you left off.

### Prompt 11

ок. а можешь мне теперь также кратко сказать что в десктоп версии изменилось с последнего релиза. и я бы хотел оформить релиз десктоп версии тоже

### Prompt 12

так бля. если кратко

- improve command+k palette
- tags (phrase-based, line-based, block-based, note-based) support
- feature: review pane (consolidated notes so you can see all of them at once (and be able to easily review/tag certain lines/blocks and so on)
- mcp server
- navbar trees ui improvement
- refactor keyboard shortcuts related code
- fix blank line bug
- cascade deletion of recording/attachment on note deletion
- fix whisper transcription on desktop



я думаю вот такой changelog...

### Prompt 13

ok, commited to main. proceed with release now.

### Prompt 14

Check `gh run list --workflow=release.yml --limit 1` for the desktop-v0.6.0 release build. If completed successfully, verify it's marked GitHub's latest release (`gh api repos/oogxdd/type/releases/latest --jq '.tag_name'` should return desktop-v0.6.0) and that the release has the expected assets (dmg, app.tar.gz, .sig, latest.json) via `gh release view desktop-v0.6.0`. Then update the release notes on desktop-v0.6.0 using `gh release edit desktop-v0.6.0 --notes '...'` with this exact user-app...

### Prompt 15

can you roll out new release (both desktop and mobile)

i dont care about the release notes - just bump a minor version to both and roll out both

### Prompt 16

Resume the mobile 0.3.0 ad-hoc release pipeline. Background task bf3fgeeea (xcodebuild archive, run from apps/mobile/ios) should be done or close to it — check its status/output. If it succeeded, verify the archive version:

/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleShortVersionString" -c "Print :ApplicationProperties:CFBundleVersion" apps/mobile/ios/build/Type.xcarchive/Info.plist

Expect 0.3.0 / 2026091701. Then run the export step from apps/mobile/ios:

xcodebuild -e...

