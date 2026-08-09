# Сборка и тестирование на Маке (после перехода на монорепу)

Практическая шпаргалка для случая «на другой машине есть Мак, нужно
собрать и потестить». Покрывает оба шелла — десктоп (Tauri) и мобилку
(React Native/Expo) — поверх общего Rust-core.

Подробности по каждому пункту — в связанных доках, здесь только маршрут.

## С чего начать

```sh
git clone <repo> && cd type
npm install     # npm workspaces поднимет apps/* и packages/* одной командой
```

---

## Десктоп (Tauri)

### Разработка (HMR, без прод-подписи)

```sh
npm run desktop:tauri -- dev
```
React — Vite HMR мгновенно; Rust — `tauri dev` сам пересобирает и
перезапускает окно.

### Просто DMG для локальной проверки (dev-конфиг, без прод-подписи/апдейтера)

```sh
npm run tauri:build:dev -w type
```
Собирает `.dmg` по `src-tauri/tauri.dev.conf.json` — быстрый способ
получить установочный файл для ручной проверки, не связываясь с ключами.

### Полная прод-сборка (с апдейтером и/или нотаризацией Apple)

Два независимых слоя подписи поверх обычной `tauri build`:

**1. Апдейтер (обязателен для авто-обновлений внутри приложения)**

Один раз:
```sh
npm run tauri signer generate -- -w ~/.tauri/type-updater.key
```
Публичный ключ (`~/.tauri/type-updater.key.pub`) — в
`apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
(коммитится). Приватный ключ — никогда не коммитить, хранить в
менеджере паролей.

При каждой сборке:
```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<пароль>"
npm run tauri build -- --bundles app,dmg
```
Именно `app,dmg` — один `dmg` не создаёт `.tar.gz`/`.sig`, нужные
апдейтеру. Результат в `src-tauri/target/release/bundle/`:
`dmg/*.dmg` (инсталлятор), `macos/Type.app.tar.gz` + `.sig` (пейлоад
апдейта и подпись).

**2. Нотаризация Apple (опционально — убирает "unidentified developer")**

Без неё `.dmg` всё равно работает и обновляется, просто первый запуск
требует правый клик → «Открыть». С нотаризацией нужны секреты/env:
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID` (используются `tauri-action` в CI; локально —
через `bundle.macOS.signingIdentity` в конфиге).

**Готовый скрипт "под ключ"** — когда не хочется собирать вручную или
кончились бесплатные минуты GH Actions:
```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<пароль>"
apps/desktop/scripts/release-local.sh 0.5.0
```
Бампит версию, собирает `app,dmg`, собирает `latest.json`, публикует
GitHub Release через `gh release create` (`gh auth login` нужен один
раз). Apple-нотаризацию сам не делает — только updater-подпись.

Подробности: [`docs/RELEASING.md`](./RELEASING.md),
[`docs/DESKTOP_AUTO_UPDATE.md`](./DESKTOP_AUTO_UPDATE.md).

---

## Мобилка (React Native / Expo)

### Демо-режим (без нативной сборки, работает сразу — Expo Go тоже ок)

```sh
npm run mobile:start
```
Крутится на in-memory моке ядра (`mock-core.ts`): полностью
интерактивно, ничего не персистится. Для чистой UI-работы нативная
сборка не нужна вообще.

### Dev-client с настоящим Rust-ядром (собирается один раз, дальше hot reload)

Предпосылки: Xcode,
`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`.

```sh
# once, в packages/mobile-core — тул мак-онли, поэтому --no-save
npm install --no-save uniffi-bindgen-react-native@0.31.0-3

npm run mobile:ios   # с корня: codegen:ios + expo run:ios одной командой
```

Перед первым разом раскомментировать импорт сгенерённого модуля в
`apps/mobile/src/core/boot.ts` (`setRawCore(generated)`) — по умолчанию
закомментирован, т.к. `src/generated/` не в гите.

Дальше цикл разработки:
- правите TS → `npm run mobile:start`, hot reload в уже стоящий
  dev-client, без пересборки;
- правите Rust (`type-core`/`type-ffi`) → пересборка dev-client:
  `npm run mobile:ios` (или фоновый вотчер `npm run mobile:ios:watch`,
  сам следит за `crates/` и пересобирает).

Для реального устройства (не симулятора) — `codegen:ios:device` вместо
`codegen:ios` (симуляторная сборка не даёт device-слайс).

Подробности: [`apps/mobile/README.md`](../apps/mobile/README.md),
[`packages/mobile-core/README.md`](../packages/mobile-core/README.md),
[`docs/architecture/09-adding-features-and-codegen.md`](./architecture/09-adding-features-and-codegen.md).

---

## Gotchas

- **`npm run desktop:tauri -- build` (или голый `tauri build`) падает с
  `A public key has been found, but no private key. Make sure to set
  'TAURI_SIGNING_PRIVATE_KEY' environment variable.`** — это не значит,
  что сборка не удалась. `.app`/`.dmg`/`.tar.gz` уже собраны к этому
  моменту ("Finished N bundles" в логе выше), падает только шаг подписи
  updater-пейлоада. Причина: `plugins.updater.pubkey` в
  `tauri.conf.json` непустой, а `bundle.createUpdaterArtifacts: true` —
  этого достаточно, чтобы Tauri потребовал приватный ключ.
  - Просто хотите потестить билд локально → пересоберите через
    `npm run desktop:dmg:dev` (dev-конфиг, апдейтер выключен, ключ не
    нужен) — см. «Просто DMG для локальной проверки» выше.
  - Нужен рабочий апдейтер → экспортируйте
    `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` перед сборкой — см.
    [UPDATER_KEY_ROTATION.md](./UPDATER_KEY_ROTATION.md).
