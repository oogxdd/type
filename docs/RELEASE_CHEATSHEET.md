# Шпаргалка по релизам (по-простому)

Подробности — в [RELEASING.md](./RELEASING.md). Здесь только «нажми вот это».

> Везде ниже `0.5.0` — пример. Подставляй свою следующую версию.

---

## 0. Разовая настройка (сделать один раз, иначе ничего не поедет)

- [ ] Слить `2jun` → `main` (воркфлоу и Pages работают от `main`).
- [ ] Включить GitHub Pages: Settings → Pages → Source = **GitHub Actions**.
- [ ] Сгенерить ключ апдейтера: `npm run tauri signer generate -- -w ~/.tauri/type-updater.key`.
- [ ] Вставить **публичный** ключ в `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` и закоммитить.
- [ ] Добавить секреты в репо (Settings → Secrets → Actions):
  - Десктоп: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  - iOS: `APPLE_IOS_CERTIFICATE_P12`, `APPLE_IOS_CERTIFICATE_PASSWORD`, `APPLE_IOS_PROVISIONING_PROFILE`, `APPLE_ASC_API_KEY_P8`, `APPLE_ASC_API_KEY_ID`, `APPLE_ASC_API_ISSUER_ID`.
- [ ] Для локальных билдов: `gh auth login` на маке.

---

## 1) Релиз iOS через OTA (только JS, без App Store)

Для фронтовых правок. Без тега, без ревью Apple.

```bash
git push origin main
```

Pages пересоберёт OTA-бандл, приложение само подтянет.

**Чего не хватает:** включённый Pages (пункт 0). Больше ничего.

---

## 2) Релиз iOS (нативный, в App Store)

Когда менялся Rust/нативный код.

```bash
git tag v0.5.0-ios && git push origin v0.5.0-ios
```

**Чего не хватает:** iOS-секреты (пункт 0). И почистить `package.json` `ios:push`
от захардкоженного пути/issuer.

---

## 3) Релиз десктоп (.dmg + авто-апдейт)

```bash
git tag v0.5.0-desktop && git push origin v0.5.0-desktop
```

CI соберёт `.dmg`, подпишет, выложит в GitHub Release. Старые установки обновятся
сами через Settings → Updates.

**Чего не хватает:** ключ апдейтера + pubkey в конфиге + 2 десктоп-секрета (пункт 0).

---

## 4) Релиз обоих (десктоп + iOS)

```bash
git tag v0.5.0 && git push origin v0.5.0
```

**Чего не хватает:** всё из пунктов 2 и 3 вместе.

---

## 5) Релиз локальным билдом (кончились бесплатные минуты GitHub)

Собираешь на своём маке, результат тот же, что и в CI.

```bash
# десктоп — нужен ключ апдейтера в окружении:
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<пароль>"

scripts/release-local.sh 0.5.0 desktop   # или: ios | both
```

**Чего не хватает:** мак + `gh auth login`; для десктопа — две `TAURI_SIGNING_*`
переменные (см. выше); для iOS — рабочая локальная подпись Apple (как в твоём
текущем `npm run ios:build`).
