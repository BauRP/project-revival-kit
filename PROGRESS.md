# PROGRESS.md — Trivo Chat Elite: рабочий технический журнал

> **Порядок использования:** В новом чате сначала открыть этот файл, проверить HEAD рабочей ветки, сравнить его с указанной ниже проверенной базой и изучить только изменённые или необходимые для текущей задачи файлы. **КРИТИЧЕСКОЕ постоянное требование пользователя:** при КАЖДОМ запросе по разработке/проверке/анализу Trivo Chat Elite, даже если пользователь не упомянул журнал и даже если не было изменений кода, обязательно актуализировать ЭТОТ ЖЕ PROGRESS.md непосредственно в GitHub. Это не ограничивается крупными пакетами. Если по запросу не было подтверждённых кодовых изменений — записать результат и статус без выдуманных процентов. При отсутствии доступа к GitHub честно сообщить, что обновление не выполнено; никогда не выдавать несохранённое за сохранённое. Достоверность: «код просмотрен» ≠ «функция проверена на устройстве».

## 0. БЫСТРЫЙ СТАРТ — прочитать за 2 минуты

| Поле | Зафиксированное состояние на 2026-11-12 |
|---|---|
| Приложение | **Trivo Chat Elite**, приватный Android/Web мессенджер с Tor v3 onion, локальными данными и E2EE |
| GitHub | https://github.com/BauRP/project-revival-kit |
| Рабочая ветка | **chatgpt/trivo-security-compat-20261031**; **main не менять** |
| Последний подтверждённый КОДОВЫЙ HEAD, на базе которого составлен журнал | **7633c943e54a85c54bd2079af8859e79303cd49d** |
| Последний полностью успешный workflow | **build-352**, https://github.com/BauRP/project-revival-kit/actions/runs/43275104233; completed/success на `7633c943`: Vitest, TypeScript, Web, Android JVM/APK, 4 Tor ABI, signature и Android 15 x86_64 install/reinstall с сохранением тестового файла |
| Проверенная APK | https://github.com/BauRP/project-revival-kit/releases/download/build-352/app-universal-debug.apk — universal debug APK, CI signature+Android 15 x86_64 install/reinstall SUCCESS |
| Оценка готовности ПО | **39,8%** (+0,2 п.п. после build-351): на Android шифруются имена контактов в основной Dexie contacts, старые plaintext имена лениво переносятся с проверкой конфликтов; экспорт V3 расшифровывает эти поля, импорт заново защищает их под ключом устройства. Полное шифрование сообщений/служебной истории и готовых вложений ещё НЕ выполнено. |
| Недавняя работа | **build-352:** новый `dexie-contact-protection.ts` и 5 Vitest тестов: Keystore/AES-GCM защищает displayName (основная trivo-p2p/contacts), AAD привязан к onion, старые имена мигрируют через read-verify-compare-commit, lastSeen/onion индексы сохранены; V3 export расшифровывает, import шифрует до одной Dexie transaction; protected-record-inventory обнаруживает ciphertext при утрате Keystore wrapper. CI FULL SUCCESS. Сообщения/lifecycle/blobs всё ещё plaintext. |
| **P0, наибольшие пробелы** | Реального PQXDH/ML-KEM **нет**; локальная Dexie-база переписки не шифруется полностью; нет независимого от WebView нативного фонового отправителя; полноценной встроенной офлайн-STT-модели нет |
| **Ближайшая инженерная задача** | **P0:** полное шифрование Dexie messages/lifecycle/contacts и готовых media с безопасной миграцией всех прямых читателей/писателей, портативной backup и без замены identity; использовать tested local-record-key-store/protected-record-inventory, расширяя inventory перед новым ciphertext. **P1:** Android Keystore/protected profile runtime crash-restart и Dexie migrations integration tests. |
| Открыть первыми | src/lib/dexie-db.ts, src/lib/storage.ts, src/lib/safe-storage.ts, src/lib/crypto.ts, android/app/src/main/java/com/baurp/trivochat/SecureVaultPlugin.java, src/lib/p2p.ts, src/lib/backup.ts, src/lib/backup-merge-policy.ts |
| Контрольные команды | **bun install --frozen-lockfile** → **bunx vitest run** → **bunx tsc --noEmit --pretty false** → **CAP_BUILD=1 bun run build** → stage-web/fix-relative-assets/verify-web-dir → **npx cap sync android** → в android: **./gradlew clean assembleDebug --no-daemon --stacktrace** |
| Ограничения | Нет Firebase/Supabase, внешней базы, рекламы, обязательной регистрации на сервере или облачного AI; secrets не записывать. Жалобы/репорты (направление 13) **на паузе**. Никаких принудительных push/rebase/squash опубликованной истории. **AGENTS2.md — постоянные инструкции; AGENTS.md Lovable не трогать.** |

**Правило коммитов для журнала:** SHA самого коммита, содержащего текст PROGRESS.md, невозможно заранее вписать в его же содержимое. Поэтому поле выше обозначает последнюю проверенную **кодовую базу** до создания журнала. SHA коммита журнала смотрите через историю PROGRESS.md и обновляйте поле при следующем пакете разработки. Дату и цифры ниже не менять задним числом без оснований.

### Что делать при возобновлении (быстро)
1. Открыть https://github.com/BauRP/project-revival-kit/blob/chatgpt/trivo-security-compat-20261031/PROGRESS.md.
2. Проверить git ref рабочей ветки; сравнить с последней зафиксированной **кодовой** базой 7633c943…; отдельно учесть документационные коммиты и новые изменения третьих сторон.
3. Если HEAD изменён другим ChatGPT/Lovable — прочитать diff именно этих коммитов, проверить конфликты и актуализировать записи; не перезаписывать чужую работу.
4. Перейти к очереди P0/P1 в разделе 9. Сначала реальные исправления, затем unit + TypeScript + Android APK в одном логическом пакете.
5. Обновить таблицу готовности **только за реально реализованное и автоматически проверенное**. Полный физический runtime на телефоне пользователя — отдельная пользовательская проверка, не «недоделанная программная работа».

---

## 1. Паспорт, источники и границы достоверности

- **Каноническое имя:** Trivo Chat Elite; package/applicationId: **com.baurp.trivochat**; репозиторий **BauRP/project-revival-kit**. В ARCHITECTURE.md исторически встречается «Trivo Sync Elite»; не переименовывать приложение по старому документу.
- **Назначение:** приватные 1:1 чаты, файлы и медиа, контакты, сообщения с таймерами, настройки приватности, Tor/P2P, локальное автономное хранение; пользовательские функции должны по возможности работать без интернета, передача собеседнику требует Tor.
- **Архитектура:** React 19/TypeScript, Vite 7, TanStack Router/Start, Tailwind CSS 4, Radix/shadcn, Lucide; Capacitor **8.5.0**; Android Java + Gradle/Java 21; tweetnacl, @noble, Web Crypto, Dexie 4/IndexedDB, Web Workers. Экспериментальные @nlpjs/* и ML Kit Translation. См. package.json, README.md, capacitor.config.ts, android/app/build.gradle.
- **Сетевой транспорт:** Tor v3 onion через кастомный Capacitor-плагин TorTransport и TorOnionService (tor-android/jtorctl **0.4.5.7**), виртуальный порт **8443**, SOCKS5. Это не централизованный мессенджер; нет BaaS.
- **Локальное состояние:** Dexie IndexedDB для контактов, сообщений, зашифрованного исходящего outbox, входящего inbox_raw, lifecycle/tombstones, Blob и частичных частей; отдельная IndexedDB **trivo-outbox** для запланированной отправки; Android Keystore для чувствительных ключей и запланированного текста. **Текст истории в Dexie в настоящее время не полностью зашифрован на диске**.
- **Android:** minSdk **24 (Android 7)**, targetSdk **36 (Android 16)** по build.gradle/проверке APK; целевой пользовательский диапазон совместимости **Android 7–17** — Android 17 НЕ объявлять протестированным или реализованным лишь по наличию target 36. ABI arm64-v8a, armeabi-v7a, x86_64, x86; AAR содержит libtor.so, наличие проверяется CI.
- **Фактически использованные источники для начального журнала:** текущий HEAD и GitHub Actions build-295; README.md, ARCHITECTURE.md, AGENTS.md, roadmap.md, .lovable/plan/trivo-chat-elite-stabilization-plan-phased-2026-10-08.md, package.json, workflow, Manifest, компоненты и взаимосвязанные модули ниже; утверждённые решения и 20 направлений из предыдущих рабочих чатов. Неизвестные настройки и непроверенные сценарии обозначать «не подтверждено».
- **Иерархия источников при расхождениях:** актуальный код/конфиг на HEAD → фактический workflow/status → явно утверждённые пользователем требования → старые README/планы. Например, roadmap.md до сих пор пишет, что первого зелёного CI нет: это устарело, build-295 зелёная. AGENTS.md пишет, что native не держит входящую очередь, но файл **tor/NativeInboundQueue.java существует и используется**; см. реальное состояние, не повторять старую архитектурную формулировку. ARCHITECTURE.md упоминает OnionFrameQueue.java и connection-manager.ts, которых нет среди текущих файлов — историческое описание, не создавать их автоматически.
- **Риск трактовки тестов:** зелёная CI подтверждает unit, TypeScript, web build, Gradle debug, SDK/ABI аудит и публикацию APK; не подтверждает работу между двумя физическими устройствами, отсутствие ANR, стойкость к атакующему peer или реальную совместимость со всеми версиями Android.

## 2. Утверждённые, временные и открытые решения

### 2.1 Утверждено пользователем; НЕ переопределять без согласования
1. Единственный основной путь связи — приватный **Tor v3 .onion P2P**; без Firebase, Supabase, обязательных внешних серверов, оплаты за API, облачного хранения переписок, рекламы/аналитики.
2. Контакт/identity = один точный .onion-адрес, производный от Ed25519 signing key; никаких параллельных псевдо-ID и небезопасной бесшовной генерации новой личности при ошибке чтения Keystore.
3. E2EE; «доставлено» только после подтверждения другой стороной **после сохранения**, не просто после успешной записи TCP. Очередь и обработка повторов устойчивы к перезапуску.
4. Локальные функции (включая будущую расшифровку речи, перевод при доступных моделях, историю) приватные и по возможности **офлайн**. Не посылать аудио или приватный текст в облачный AI.
5. Автоматические зашифрованные резервные копии с удобным восстановлением; минимальные повторные вводы пароля, сохранение идентичности, миграции без потери данных. Восстановление чужой идентичности допускается **только по явному выбору на действительно пустом устройстве**.
6. Удаление сообщения «у себя» доступно независимо от защиты истории; одноразовые медиа после просмотра не восстанавливаются ретраями/backup.
7. **Направление №20 «Защита истории переписки»:** настройка индивидуально на чат, в меню «три точки»; чужое «Удалить у всех» и «Редактировать» при защите получателя не исполняются и показывают точный текст **«У пользователя включена защита истории переписки.»** (в коде с завершающей точкой). «Удалить у себя» остаётся разрешённым; кнопки «Удалить у себя» и «Удалить у всех» не скрывать и не отключать.
8. **Направление №13 «Жалобы/репорты» поставлено на паузу**; не развивать, не отправлять никуда данные без нового разрешения.
9. Android **7–17**, разные дисплеи, ориентации, системные панели, жесты и три кнопки; не заходить под статус-бар и нижнюю системную навигацию, учитывать клавиатуру.
10. Сначала критические сбои/потеря данных/безопасность; затем крупные логические пакеты по максимально незавершённым направлениям. Работа сохраняется исключительно в ветке **chatgpt/trivo-security-compat-20261031**; **main не трогать**.
11. Сохранять опубликованную историю Git (AGENTS.md: Lovable синхронизируется с веткой; force-push/rebase уже опубликованных коммитов опасны).
12. Все функции и проверки кода, которые реально выполнимы инструментами, делать самостоятельно; невозможность лично установить APK на пользовательский телефон **не считается незавершённой программной задачей**. Пользовательские испытания указываются отдельно.
13. Для будущих отчётов: **20 направлений + процент + прирост, общая готовность рядом с таблицей**; не придумывать повышения за макеты, заглушки или планы.
14. Не создавать автопродолжение по расписанию и не включать фоновую автоматизацию ChatGPT без отдельного запроса.

### 2.2 Реализованные текущие значения/поведение, подтверждённые кодом
- SettingsPage.tsx: уведомления по умолчанию **true**, скрывать содержимое уведомления **true**; экспериментальный cover traffic **false**; data saver через data-saver.ts (начальное состояние при отсутствии настройки — off). Тема, язык, биометрия, безопасность, резервное копирование находятся в отдельных компонентах. Уведомления Android требуют разрешение пользователя; при невозможности прочитать privacy preference функция notificationPreferenceUnavailable запрещает утечку содержимого.
- ChatRoom.tsx: первично silent=false, oneTimeView=false; предусмотрены reply, edit, pin/unpin, реакции, поиск, удаление, вложения, круговое видео, назначение папок, настройки исчезновения, mute, блокировка, история, перевод, планирование; наличие UI не доказывает полноту каждого сценария.
- chat-preferences.ts: disappearingDuration = **off/1h/6h/12h/24h**; временное отключение уведомлений и «навсегда».
- Android Tor FGS уведомление по умолчанию не отображает приватный адрес; AndroidManifest.xml содержит camera/mic/media/notifications/FGS разрешения. Старт Tor не должен препятствовать первому показу UI.
- Автоматические бэкапы **opt-in**, период **24 ч**, проверка из живого видимого WebView, до **7 автоматических** архивов; ручные копии не удалять; автоматический экспорт пропускается, если локальные медиа превышают **192 MiB**; пароль восстановления **12–1024 символа**, запечатан Keystore. Нет Android WorkManager для бэкапа.
- Резервный файл V2: **TRIVO-BACKUP-V2**, AES-256-GCM, PBKDF2-SHA256 **600000 итераций**, случайные соль/nonce; переносимая V1-пакетная структура внутри зашифрованного контейнера, identity и DexieDump. Legacy V1 только для чтения. Путь Android: Documents; писать сначала *.pending, затем rename, вручную скачиваемый web-fallback.
- Размер одного вложения — до **1 GiB**; Tor передаёт части по **48 KiB**; повторный запрос недостающих чанков до **128** за окно; media-send-gate ограничивает одновременно отправляемые крупные передачи. Кэш Blob-данных имеет кодовый лимит **3 GiB** (dexie-db.ts). Не путать эти три лимита.
- Офлайн проверка вложений в security-scan.ts — анализ расширения/MIME/сигнатуры, блокировка активного содержимого и удаление EXIF из допустимых изображений; **это не полноценный антивирус**.
- «Реальный статус Tor»: status.running, bootstrapped, percent, валидный v3 onion и отсутствие ошибки; UI TransportStatusChip / SecurityDashboard.
- Экспериментальный cover-traffic выключен по умолчанию; не заявлять гарантию анонимности из-за пары dummy-пакетов.
- Истинной постквантовой защиты нет: pqxdhEncrypt/pqxdhDecrypt в crypto.ts явно **throw Error**, SecurityDashboard показывает «Постквантовая защита не подтверждена».

### 2.3 Временно / в обсуждении / ещё не реализовано
- Настоящий **ML-KEM/PQXDH/hybrid protocol**: нужны проверенная библиотека, криптографический дизайн, version negotiation, миграция peer и сквозные тесты. Решение о конкретной библиотеке и wire-версии пока **не утверждено**.
- Полное шифрование локальной Dexie (история, контакты, lifecycle, индексирование) и надёжный поиск/медиа при шифровании — серьёзная открытая задача; не выдавать Keystore шифрование **identity** за шифрование всей БД.
- Бэкграунд-доставка/планирование при **убитом** WebView: требуется отдельная native-политика с учётом Android 7–17, FGS/WorkManager ограничений и секретов, не простое setInterval.
- Полноценная автономная STT-модель с runtime в APK; TranscriptionPlate сейчас объясняет недоступность. Серверные функции существуют в репозитории, но их наличие не означает реализованную offline STT.
- Полная безопасность неизвестных файлов/проверка вредоносного кода не достигнута эвристической MIME-проверкой.
- Android 17 и все комбинации навигации/экранов/прошивок — целевой объём совместимости; текущий build target 36, только сборочный аудит.
- Голосовые/видеозвонки, если они видны через CallScreen.tsx, нельзя объявлять работоспособным P2P-VoIP до проверки реальной media-сессии. Выяснять по коду и тестам перед процентами.
- Историческая .lovable/plan/... — план стабилизации 2026-10-08; roadmap.md устарел, его незакрытые пункты не являются более достоверными, чем успешные Actions.
- Любая настройка, не раскрытая явно кодом/перепиской, имеет **статус «требуется уточнение»**, а не выдуманное значение.

---

## 3. Готовность по 20 направлениям — базовая точка

**Зафиксированная после build-352 общая оценка: 39,8%** (+0,2 п.п. от build-351 за защищённые имена контактов в основной Android Dexie, совместимый V3 export/import, fail-closed при потерянном ключе; полное Dexie шифрование ещё НЕ реализовано). Это прежняя согласованная **оценка программной готовности**, не объективное вычисление количества функций. Проценты не суммировать/не усреднять как общий показатель: направления различаются по весу, сложности и рискам. Если методика весов станет фиксированной, описать её явно. **Пауза направления 13 не даёт права объявить его выполненным.**

| № | Направление | Готово | Последний прирост | Что есть / проверено | Остаток и ограничения |
|---|---|---:|---:|---|---|
| 1 | Настоящая постквантовая криптография | **0%** | 0 | Отсутствие PQ честно отображается; tests/pqxdh-safety.test.ts | Реальный ML-KEM/гибрид с безопасным handshake, версиями и тестами, не заглушка |
| 2 | Шифрование локальной БД/ключей | **22,2%** | **+0,5** | Build-352: Android Keystore AES-GCM for Dexie contacts displayName, onion/index stays clear, legacy compare-and-put migration and key-loss inventory; Vitest+APK SUCCESS. Messages/lifecycle/blobs remain plaintext | CRITICAL: messages/lifecycle/contacts/готовые media остаются plaintext; нет реальной полной Dexie migration |
| 3 | Резервные копии и восстановление | **63,6%** | **+0,1** | Build-352: V3 portable export decrypts protected Android contact names, import pre-encrypts with target device key before Dexie transaction; CI green, actual cross-device recovery not device-tested | Real Dexie concurrent-write fault injection, cross-device restore, large archive memory testing |
| 4 | Отложенная отправка | **43,2%** | 0 | trivo-outbox, Keystore, миграция, dedupe, clock correction, visibility wake; build-295 | Доставка при завершённом WebView/force-stop, строгие жизненные циклы, device-level проверка |
| 5 | Фоновый Tor | **52,4%** | 0 | Build-351: signed Tor friend-request statuses persisted via CAS before durable ACK; duplicate/declined/accepted handling does not re-notify or roll back, strict transaction and APK CI green | Нативная отправка без WebView, integration power-loss/FGS tests |
| 6 | Защита сообщений/edit/delete | **63,6%** | 0 | Build-348: incoming per-chat summary merges latest authenticated message ID, unread counters update with conditional IndexedDB commit; delayed old message cannot replace newer preview; async callback rejections logged | Full encrypted Dexie history and peer integration |
| 7 | Офлайн STT | **5,0%** | 0 | UI и обработчики-заглушки, stt-cache без plaintext | Реальная модель и inference в APK offline, многоязычность и метрики |
| 8 | Уведомления | **46,2%** | 0 | local notifications, mute/block/silent, приватные preview, fail-closed | Фоновая нативная обработка, каналы/режимы Android, надёжное отображение |
| 9 | Безопасная проверка файлов | **26,8%** | 0 | MIME/signatures/EXIF/active content, signed manifest, валидация полученного Blob | Не антивирус; расширенные форматы/unsafe вложения, DoS scanning, sandbox |
| 10 | Синхронизация профилей | **27,2%** | 0 | Build-351: acceptance and incoming/outgoing friend requests use atomic read/compare-write with guarded retries; accepted stays accepted, declined outgoing may be explicitly re-invited; unmount stops listeners | конфликт версий, offline reconcile, полноценные тесты синхронизации |
| 11 | Реакции/синхронизация | **36,5%** | 0 | Builds 324–326: incoming/local deleted-message reaction rejected, old legacy reaction map filtered; queued immutable reaction event IDs removed atomically for chat delete, local/remote global delete and restore tombstones; CI tests | Integration of offline merge and two-peer reaction conflicts |
| 12 | Экономия трафика/медиа | **76,7%** | 0 | Build-342: аудиоволны грузятся только из локальных URL с лимитом 8MiB, bounded streaming/abort/context close, 1024 samples/bar, React обновляется по timeupdate, playback прежний; unit+APK green | Streaming large blobs, real IndexedDB fault injection and memory budgets |
| 13 | Жалобы/репорты **ПАУЗА** | **0%** | 0 | Кодовая UI-заготовка может существовать | Не менять без разрешения пользователя |
| 14 | Одноразовые вложения | **40,5%** | 0 | Durable consumed markers; build-330 NEW backup export excludes stale Blob bytes of consumed one-time attachment and removes old media preview | Real Android one-time consumption + interrupted backup integration |
| 15 | Подлинный Tor статус | **27,0%** | 0 | strict isTorServiceReady; проверка .onion; status chip; build-283 | серверная достижимость, показ ошибок/повторных reconnect |
| 16 | Маскировка трафика | **8,0%** | 0 | экспериментальный sealed cover; off default | реальная доказуемая защита от анализа трафика, аккумулятор/сеть |
| 17 | Android permissions | **66,7%** | 0 | Build-346: единая native-only биометрическая блокировка со startup lock, failed authentication stays locked, skip insecure web/unsupported hardware and unreadable preference writes; CI tests+APK SUCCESS | Android 13+/14+/16+/17 permission and FGS variations |
| 18 | Автоматизированные испытания | **73,3%** | **+0,2** | Build-352: 5 new AES-GCM Dexie contacts unit tests (confidentiality, AAD/row tamper, wrong key, legacy and missing name, snapshot conflicts); Vitest, strict TS, Web, Android JVM/APK and Android15 install/reinstall SUCCESS | Android runtime Keystore/device kill and actual Dexie migration integration |
| 19 | Android 7–17 и экраны | **19,3%** | 0 | Build-344 Android 15 x86_64 repeat APK install successful; WebView audio waveform bounded to reduce renderer pressure; остальные API не испытаны | API/gestures/IME/fold/rotation/runtime/Android17 |
| 20 | Защита истории переписки | **57,1%** | 0 | Per-chat toggle, signed receiver enforcement, deleted-message tombstone privacy; builds 324–326 prevent deletion reactions/outbox restore | Real two-device UI protection & edit/delete behavior tests |

**Порядок изменения метрик:** прежде показывать прежний %, затем фактически выполненные файлы, тесты и CI SHA, затем новый %; прирост может быть **0,0** при реальной работе, если фича ещё не прошла проверку. Общий % пересматривать консервативно; не увеличивать его только потому, что добавились коммиты или тесты. Если проведена лишь документация/аудит — **0 прироста**. Испытание, которое пользователь делает на своём устройстве, указывать отдельно, без уменьшения программной готовности.

---

## 4. Архитектура и технические инварианты

### 4.1 Последовательность отправки и приёма
1. src/lib/crypto.ts генерирует/валидирует Ed25519/X25519 identity; src/lib/onion-id.ts выводит канонический .onion из Ed25519 public key с контрольной суммой SHA3.
2. src/lib/envelope.ts (sealFrame/openFrame) выполняет authenticated encryption + signature. Сейчас это **классическая криптография NaCl**, а НЕ ML-KEM/PQXDH. src/lib/workers/crypto.worker.ts и crypto-async.ts отделяют тяжёлую криптографию/JSON от UI там, где возможно.
3. src/lib/onion-engine.ts onionSendDispatch: seal → Dexie outbox ciphertext → TorTransport.send → retry/backoff; попытка транспорта не равна доставке. Повтор одного id сериализован; запрещено переадресовать тот же id другому peer.
4. Native TorOnionService принимает кадры; **NativeInboundQueue** надёжно сохраняет sealed frame до ACK на уровне TCP, затем plugin.pendingInbound/acknowledgeInbound передаёт JS. В JS sealed inbox_raw и commit в Dexie; **DELIVERED_ACK** только после принятия/записи, idempotent при повторном кадре.
5. src/lib/inbound-frame-policy.ts/inbound-message.ts/inbound-identity.ts проверяют signed, но всё ещё недоверенные структуры. Не верить полям type/from/to/URL только потому, что есть подпись.
6. src/lib/sync/message-lifecycle.ts + history-protection.ts обеспечивают правомочность правки/удаления; tombstone и redaction против повторов и старых резервных копий.
7. src/lib/media-store.ts → Blob Dexie → onion-engine.ts 48 KiB signed chunks → partial_chunks → verified assembly → putReceivedBlob; request windows + media-send-gate; удалить файл нельзя обойти поздней доставкой благодаря lifecycle + transaction.

**Не менять без причины:** порядок «проверка → атомарная запись → подтверждение», sender authorization, sender/recipient matching, monotonic irreversible tombstones, отсутствие plaintext в сетевом frame. Изменение wire формата требует version negotiation и совместимых APK у обоих peers.

### 4.2 Форматы и хранилища
- Identity: Ed25519 signing и X25519 exchange pairs (src/lib/crypto.ts). Приватные части защищены Android Keystore через SecureVaultPlugin.java; есть защищённая локальная recovery copy. **Нельзя** silently reset identity после повреждения хранилища.
- Dexie schema: contacts keyed by onion; messages keyed by id; outbox pending/sent/failed с frame, attempts, nextAttemptAt; inbox_raw sealed frames; lifecycle keyed by chat-specific key; blobs и partial_chunks.
- Отдельная IndexedDB trivo-outbox / scheduled: id, chatId, text (в Android Keystore sealed), scheduledAt immutable, attempts, nextAttemptAt. Реальная сеть может быть недоступна при закрытом WebView.
- Retention: сообщение с «удалено» должно иметь lifecycle marker, его текст/подпись/медиа не должны восстанавливаться из backup или повторного Tor frame. Одноразовый файл содержит consumed-media::{fileId}. Нельзя заменить tombstone на устаревшую локальную запись при импорте.
- Backup: внешний .tvc **шифрован**; V2 envelope, 600k PBKDF2, AES-GCM; внутри portable package + DexieDump schemaVersion **3**. Backup validator ограничивает таблицы/размеры и отбрасывает повторные primary key. Дамп импорта **не активирует старый outbox**, чтобы не отправить повторно чужие старые сообщения.
- Auto backup: включение после успешного ручного password backup; Keystore sealed recovery passphrase, когда Android WebView активен. Выгрузка до media limit, архив сначала *.pending, после rename становится видимым для выбора восстановления. Сбой записи не должен разрушать старые копии.
- Native queue: tor/NativeInboundQueue.java, AtomicFile; **до 64 MiB**, **4096 записей**, FIFO/page, отказ от unreadable frames с логом. Это отдельная зашифрованная транспортная очередь, несмотря на устаревшее описание AGENTS.md.
- Tor native: service FGS, SOCKS5, bootstrap, ADD_ONION, updateStatus; Java worker threads, wake lock, shutdown, timeout. Нет доказательств, что приложение может гарантировать всё время активное соединение на каждой прошивке.
- Media: 48 KiB сегменты с digest; до 128 missing indices/page; лимит файла 1 GiB; sender пересматривает доступ на каждом chunk, receiver проверяет исходное signed сообщение, MIME, name, chunks count и size; конечный Blob проходит security-scan.ts. Не считать digest автоматически равным malware-free.
- Privacy UI: уведомления не должны раскрывать отправителя/текст, если установлен hide-content; при отказе в доступе к настройкам работать fail-closed.
- No cloud: файлы в src/lib/server/translate.server.ts и transcribe.server.ts исторически есть, но недоступное offline STT не заменять сетевым сервисом без разрешения пользователя.

### 4.3 Android и сборка
- capacitor.config.ts: appId com.baurp.trivochat, webDir **www/**, androidScheme https, allowMixedContent=false, minWebViewVersion=87, SplashScreen. www/ создаётся из реального web output через scripts/stage-web.mjs.
- .github/workflows/android_build.yml: push по main/master/отдельной рабочей ветке + workflow_dispatch, Bun **1.3.3**, Java **21**, Node **22**; CI выпускает **debug** APK и релиз GitHub build-N; standalone release/minify от этого **не становится проверенным**.
- android/app/build.gradle: minSdk24/targetSdk36; split APK + universal; Guardian Project tor 0.4.5.7; ABI 4. gradlew clean assembleDebug в CI.
- android/app/src/main/AndroidManifest.xml: Tor FGS + permissions, allowBackup=false, FileProvider, edge/IME; не включать Android Auto Backup для приватных ключей.
- MainActivity.java: Capacitor BridgeActivity, guarded registration of TorTransport/SecureVault/SecureView, WebView DOM storage, systemBars/IME/cutout insets, crash diagnostics.
- UI должен оставаться рабочим при неготовом Tor, при невозможности получить camera/mic permission и при временных ошибках network.

---

## 5. Карта кода — куда идти без повторного полного аудита

**В колонке «проверка»** приведены unit test имена/связи, не обещание покрытия реального устройства. Все пути относительно корня.

### 5.1 Сетевой контур и идентичность

| Файл | Назначение / важные точки | Связи, риск, что проверять |
|---|---|---|
| src/lib/onion-id.ts | normalizeOnion, isValidOnion, onionFromPublicKey, publicKeyFromOnion, torServiceKeyFromSigningSecret; canonical Tor v3 Ed25519 | envelope.ts, crypto.ts, TorOnionService.java; tests/onion-publication-policy, inbound-identity |
| src/lib/envelope.ts | SealedFrame; sealFrame/openFrame, plausibility, signed payload | crypto-async.ts, onion-engine.ts; tests/onion-envelope; **не PQ** |
| src/lib/crypto.ts | identity keypairs, generate/validate, Keystore identity, recover, classical nacl; pqxdhEncrypt/pqxdhDecrypt всегда throw | SecureVaultPlugin, identity-transfer, onion-id; tests/identity-validation, pqxdh-safety |
| src/lib/crypto-async.ts | worker dispatch, timers, async signing/encryption/JSON parse | src/lib/workers/crypto.worker.ts; worker timeout/late-response race |
| src/lib/workers/crypto.worker.ts | Криптографические/JSON задачи вне главного UI | crypto-async.ts; не раскрывать secrets в логах |
| src/lib/onion-engine.ts | onionInit, onionSendDispatch, outbox retry, native replay, ACK, dispatch, file send/receive, status | Центральный высокорисковый файл, ~1.2k строк. tests/dispatch-commit, inbound-*, blob-request-policy, media-*. Следующий аудит — гонки ACK/partial files |
| src/lib/tor-native.ts | Типы TorStatus, registerPlugin, TorTransport API | Android TorTransportPlugin.java; статус должен быть реальным |
| src/lib/tor-status-policy.ts | isTorServiceReady; running+bootstrapped+100%+checksum-valid onion+без ошибки | TransportStatusChip.tsx, SecurityDashboard.tsx; tests/tor-status-policy |
| src/lib/onion-publication-policy.ts | Отсечение публикации чужого Onion identity | onion-engine.ts; tests/onion-publication-policy |
| src/lib/inbound-identity.ts | Проверка sender/recipient identity | onion-engine.ts; tests/inbound-identity |
| src/lib/inbound-frame-policy.ts | validateDispatchBody, boundedAcknowledgements, boundedDispatchString | Не доверять подписанному JSON; tests/inbound-frame-policy |
| src/lib/inbound-message.ts | validateIncomingTextMessage, safe persisted fields, media header metadata validation | onion-engine.ts; tests/inbound-message |
| src/lib/inbound-durability.ts | политика подтверждения/долговечной обработки пакета | onion-engine.ts; tests/inbound-durability |
| src/lib/dispatch-commit.ts | shouldAckDispatch, shouldNotifyDispatch, isValidDispatchId, sameOutgoingDispatchRoute | onion-engine.ts; tests/dispatch-commit |
| src/lib/outbox-delivery-policy.ts | mayQueueOriginalText: нельзя возобновить локально удалённое исходящее сообщение | onion-engine.ts; tests/outbox-delivery-policy |
| src/lib/delivery-status-policy.ts | advanceDeliveryStatus и shouldEmitDeliveryEvent: монотонный порядок статуса в БД и доставки уведомлений UI | onion-engine.ts/p2p.ts; tests/delivery-status-policy, builds 298/301 |
| src/lib/p2p.ts | Интерфейс P2PMessage, sendP2PMessage, getMessagesForChat, redaction, legacy migration | onion-engine, dexie-db, ChatRoom; не путать с устаревшими WebRTC путями |
| src/lib/profile.ts / profile-policy.ts / profile-wire.ts | Локальный/удалённый профиль, publish/hydrate/validation | src/components/ProfilePage.tsx; tests/profile-* |
| src/lib/reactions.ts / reaction-policy.ts | reactionRecordKey, toggleReaction, broadcastReaction, persistence/timestamp | ChatRoom, onion-engine; tests/reaction-timestamps |
| src/lib/sync/peer-sync.ts | receipt/status P2P sync | ChatRoom; проверять ACK |
| src/lib/sync/message-lifecycle.ts | editMessage, deleteMessageForMe, deleteMessageForEveryone, pin/unpin, subscribeLifecycle | lifecycle-auth, history-protection, p2p; sender-side restrictions + receiver enforcement |
| src/lib/lifecycle-auth.ts | canApplyRemoteLifecycle, acceptsLifecycleTimestamp, owner-only controls | onion-engine.ts; tests/lifecycle-auth |
| src/lib/history-protection.ts / history-protection-policy.ts | setLocalHistoryProtection, getRemote..., denial of remote delete/edit, state sync и notice | ChatRoom, lifecycle, onion-engine; tests/history-protection; НЕ блокировать local delete |
| src/lib/stealth.ts | Экспериментальный cover/noise; message fragmentation helpers | SettingsPage, onion-engine; тесты/stealth-fragments; не считать полноценной маскировкой |
| src/lib/local-only-peer-policy.ts / mock-peer.ts / support-bot.ts | Изолированный офлайн demo/support bot, не отправлять в Tor | tests/local-only-peer-policy; не путать test bot с реальными контактами |

### 5.2 Данные, приватность, файлы и резервное копирование

| Файл | Назначение / экспорт | Конфликты / проверки |
|---|---|---|
| src/lib/dexie-db.ts | TrivoDexie schema, StoredMessage, putBlob/putReceivedBlob, exportDexieDump/importDexieDump, media cache | **P0: несекретный plaintext DB**, backup merge, транзакции и one-time revocation; tests/backup-merge-policy + validation |
| src/lib/storage.ts / safe-storage.ts | Legacy/app storage + IndexedDB/localStorage fallback | Ключи/migrations/boot; нельзя использовать plaintext fallback для secret |
| src/lib/identity-transfer.ts / identity-bootstrap-policy.ts / transfer-pristine-policy.ts | restoreIdentityOnFreshDevice, assertEmptyTransferTarget | Исключение только для встроенного welcome bot; key replacement на непустой базе запрещён |
| src/lib/hidden-message-migration.ts | Однонаправленная миграция старых plaintext записей | Доказать новый persistent storage до удаления old, re-run safe; tests/hidden-message-migration |
| src/lib/backup.ts | exportBackup/importBackup, portable *.tvc, temporary *.pending | backup-crypto, Dexie, identity-transfer, Filesystem; ручные/авто файлы не удалять без основания |
| src/lib/backup-crypto.ts | encryptBackupV2/decryptBackupV2, AES-GCM, 600k PBKDF2 | tests/backup-crypto, backup-input; нет Argon2id в нынешнем коде |
| src/lib/backup-package.ts / backup-validation.ts | make/readPortableBackupPackage, assertMatchingBackupIdentity, schema3, размер/duplicate IDs | tests/backup-package, backup-validation; invalid archive до DB write |
| src/lib/backup-merge-policy.ts | isIrreversiblePrivacyMarker, lifecycleRowsForRestore | tests/backup-merge-policy; deletion/consumed records monotonic |
| src/lib/backup-files.ts / backup-budget.ts / backup-media-policy.ts | Safe filename, dated auto/manual, retention, export preflight, stripSessionMediaUrl | tests/backup-files, budget/media-policy |
| src/lib/auto-backup.ts | enable/disableAutomaticBackups, runAutomaticBackupIfDue, monitor and prune | Только живой WebView; tests/auto-backup; не делать вид что реализован WorkManager |
| src/lib/legacy-backup-policy.ts | Чтение legacy V1 для миграции | backup.ts; атакующие/повреждённые архивы |
| src/lib/message-deletion-policy.ts | deletedMessageKey, redactLocalMessage, matching media metadata/manifest, mayPersistIncomingChunk | p2p/onion/dexie; tests/message-deletion-policy |
| src/lib/conversation-index-policy.ts | mergeConversationRows: стабильное слияние индексированных from/to сообщений, дедупликация, expiry | p2p.ts; tests/conversation-index-policy; build-299 |
| src/lib/one-time-policy.ts | consumedMediaKey, sanitizeRestoredOneTimeMessage | backup merge, media-store; tests/one-time-policy |
| src/lib/message-retention.ts / chat-preferences.ts | Удаление по времени, mute, disappear states | ChatRoom, p2p; tests/message-retention |
| src/lib/media-store.ts | uploadFileToTrivo, downloadFromTrivo, ensureMediaUrl, purgeConsumedMedia | Blob Dexie, onion-engine, security-scan; cancellation and object URL leak |
| src/lib/media-chunks.ts / chunk-integrity.ts | orderedCompleteChunkSet, MEDIA_CHUNK_SIZE, chunkDigest | onion-engine; tests/media-chunks/chunk-integrity |
| src/lib/media-retry-policy.ts / blob-request-policy.ts | bounded request windows, 128 missing retry, resume first missing | tests/media-retry-policy/blob-request-policy; 1 GiB large file |
| src/lib/media-send-gate.ts / media-timeout-policy.ts | Concurrency limit, idle deadline based on monotonic progress | tests/media-send-gate/media-timeout-policy; stalled uploads and WebView |
| src/lib/security-scan.ts / media-scrub.ts / image-compress.ts | Header/MIME/extension, EXIF scrub, image memory limit | tests/security-scan; **эвристика не antivirus** |
| src/lib/data-saver.ts | Автозагрузка с учётом wifi/cellular и флага экономии | ChatRoom, media-store |
| src/lib/notification-policy.ts / notifications.ts | private notification copy, mute/silent/block, LocalNotifications, on-device translation path | tests/notification-policy; Android background gap |
| src/lib/outbox.ts / scheduled-policy.ts / scheduled-encryption.ts | ScheduledItem, enqueue/remove/registerSender, retry/migration, Keystore | tests/scheduled-policy/encryption/ids; нет Native WorkManager |
| src/lib/account-wipe.ts | Удаление учётной записи и данных, pause services | tests/account-wipe; не нарушить порядок остановки Tor/backup и wipe |
| src/lib/panic.ts / boot-guard.ts / error-capture.ts | emergency protection and startup guards | MainActivity и UI error boundary; логировать без sensitive content |

### 5.3 UI, пользовательские сценарии, офлайн-функции

| Файл | Экран/сценарий, точка изменения | Замечание |
|---|---|---|
| src/components/ChatRoom.tsx | Основной экран, сообщения, media, edit/delete, history-protection, scheduled, translate, reactions, one-time, voice/video | Очень большой файл (~104k символов): **искать конкретный handler**, не читать весь заново |
| src/components/ChatList.tsx / FriendsList.tsx / AddFriend.tsx | Список диалогов, контакты, добавление через onion | Связь с profile, p2p и local-only bot |
| src/components/MessageInput.tsx / AttachmentMenu.tsx / UploadOverlay.tsx | Ввод, файлы, статус загрузки | media-store/security-scan; не объявлять 100% до рабочих device flows |
| src/components/OneTimeViewer.tsx / OneTimeMediaBubble.tsx | Просмотр однократных вложений | purgeConsumedMedia, tombstones; проверять race при закрытии |
| src/components/DeleteMessageSheet.tsx / ChatSelectionBar.tsx | Операции с сообщениями | Для protected peer кнопки должны оставаться доступны, но серверная операция отвергается |
| src/components/ScheduleSheet.tsx | Выбор времени запланированного сообщения | outbox.ts, scheduled-policy.ts; не менять исходный scheduledAt при retry |
| src/components/ReactionsBar.tsx / PinnedHeader.tsx / ChatSearchBar.tsx | Реакции, закрепление, поиск | Dexie и lifecycle, нет гарантий полного e2e без теста |
| src/components/DisappearingMessagesModal.tsx / MuteModal.tsx | Исчезновение, отключение уведомлений | chat-preferences.ts |
| src/components/TranslationPlate.tsx / TranslationSettingsPanel.tsx | Перевод и его настройки | translation-config.ts, notifications.ts, native ML Kit; строго offline |
| src/components/TranscriptionPlate.tsx | Кнопка/панель транскрибации | **Нет bundled offline ASR модели**, не заявлять готовность |
| src/lib/transcribe.functions.ts / server/transcribe.server.ts / stt-cache.ts | Обработчики-заглушки/кэш, не облачная STT | В server-модуле возвращается offline_speech_model_not_installed |
| src/lib/translation-config.ts | Языки, словарь, detectLanguage, настройки | tests не равны покрытию языков; offline only |
| src/components/RoundVideoRecorder.tsx / AudioWaveformPlayer.tsx / CallScreen.tsx | Круговое видео, аудио/звонки | Потребуют проверки реальных media APIs, Android permissions |
| src/components/SecurityDashboard.tsx / TransportStatusChip.tsx | Реальный Tor статус, ключи, privacy | tor-status-policy, onion-engine; PQ показывать как НЕ готовое |
| src/components/SettingsPage.tsx | Preferences, Tor cover, backup, biometrics, profile, delete account | Не хранить секреты в localStorage; дефолты в §2 |
| src/components/ReportMenu.tsx / src/lib/report.ts | Жалобы/блокировка | **Направление №13 на паузе**, без новых разработок |
| src/components/TabbedWorkspace.tsx / BottomNav.tsx / src/pages/Index.tsx | Основная навигация | Роутинг src/routes/*.tsx, layout, Android insets |
| src/components/FloatingVideoHost.tsx / FloatingVideo.tsx | Floating media | Избегать скрытых декодеров и жизненного цикла при закрытии |
| src/contexts/IdentityContext.tsx / LanguageContext.tsx / ThemeContext.tsx | Identity, локализация, темы | Startup/permissions и безопасный fallbacks |
| src/hooks/useBiometricAuth.ts / useVoiceRecorder.ts / useBackNavigation.ts | Биометрия/запись/системная кнопка назад | Android 7–17, IME, lifecycle |
| src/lib/support-nlp-engine.ts / workers/nlp.worker.ts | Локальный NLP-бот, не полноценная cloud AI модель | Не смешивать с реальной peer-доставкой |

### 5.4 Android и CI: точные файлы
- android/app/src/main/java/com/baurp/trivochat/MainActivity.java: startup, diagnostic экран, WebView/insets, safe plugin loading.
- android/app/src/main/java/com/baurp/trivochat/TorTransportPlugin.java: Capacitor native async bridge: start/stop/send/probe/getStatus/pendingInbound/inboundCount/acknowledgeInbound.
- android/app/src/main/java/com/baurp/trivochat/tor/TorOnionService.java: Android FGS, Tor bootstrap/hidden service, send/receive, wake lock, 24 inbound slots.
- android/app/src/main/java/com/baurp/trivochat/tor/NativeInboundQueue.java: durable sealed frame files, AtomicFile, MAX_ENTRIES=4096/MAX_BYTES=64MiB, pending/acknowledge; не стирать при обычном stop.
- android/app/src/main/java/com/baurp/trivochat/tor/Socks5Client.java и TorNativeSupport.java: TCP/SOCKS relay и libtor загрузка.
- android/app/src/main/java/com/baurp/trivochat/SecureVaultPlugin.java: Keystore AES-GCM seal/open identity/scheduled text, atomic recovery/clear identity.
- android/app/src/main/java/com/baurp/trivochat/SecureViewPlugin.java: запрет чувствительного захвата экрана/приватный режим.
- android/app/src/main/AndroidManifest.xml и android/app/build.gradle: FGS permissions, SDK/ABI; android/app/proguard-rules.pro: JNI/plugin keep rules; проверить перед изменением release.
- capacitor.config.ts, vite.config.ts, scripts/stage-web.mjs, scripts/fix-relative-assets.mjs, scripts/verify-web-dir.mjs, scripts/web-dir.mjs, .github/workflows/android_build.yml: build/staging/CI.

---

## 6. Реестр проблем, инцидентов и подтверждений

**Статусы:** OPEN = остаётся; MITIGATED = кодовое снижение риска, ещё не полное решение; FIXED-CI = конкретное исправление прошло GitHub CI; NEEDS-DEVICE = отдельный ручной сценарий, не «недоделанная программная работа». Уровни: P0 критический, P1 высокий, P2 средний.

| ID | Уровень | Причина, условия, область | Что сделано / состояние | Следующий инженерный контроль |
|---|---|---|---|---|
| SEC-01 | P0 | Ложное заявление о PQXDH: раньше случайные bytes+NaCl трактовались как hybrid. crypto.ts | Исправлено на явный отказ, UI не заявляет PQ, тест pqxdh-safety; **OPEN: настоящей PQ нет** | Рассмотреть настоящий ML-KEM handshake, key confirmation, protocol version |
| SEC-02 | P0 | История/контакты/lifecycle в Dexie частично plaintext; угроза извлечения из локального профиля/backup | Identity Keystore и текст запланированных сообщений защищены; **OPEN** | Дизайн encrypted records, encrypted indexes/search, forward migration + rollback |
| TOR-01 | P0/P1 | Фоновая доставка при завершённом WebView, Android FGS restrictions; ts timers недоступны | Нативный Tor FGS и inbound durability есть, но JS обработчик нужен; **OPEN** | Нативная единая очередь/отправитель или корректная WorkManager архитектура; не делать небезопасных plaintext копий |
| DATA-01 | P1 | При импорте старого backup tombstone мог проиграть существующему lifecycle с тем же key | backup-merge-policy, validation, восстановление одной транзакцией; **FIXED-CI build-291** | Unit/integration проверки на реальном Dexie при конфликтных записях |
| DATA-02 | P1 | Старые архивы могли вернуть уже удалённый text/media или одноразовый Blob | deletedMessageKey, consumedMediaKey, import filtering, removal existing rows; **MITIGATED/FIXED-CI** builds 291/293 | Расширить тесты concurrent restore/recipient delete/media-open |
| DATA-03 | P1 | Импорт массива Blob выделял много памяти и мог зависать при больших бэкапах | С 294: последовательная base64 decode+put в одной транзакции; **FIXED-CI**, остаётся общий JSON limit | Streaming encrypted archive/restore (требует совместимой versioned migration) |
| DATA-04 | P1 | Порванная запись backup могла выглядеть готовым *.tvc | С 284: *.pending → rename только после write; **FIXED-CI** | Проверить crash modes API Filesystem, очистку старых *.pending |
| DATA-05 | P1 | Transfer identity на непустом устройстве может потерять существующую личность | identity-transfer: assertPristineDevice до/после остановки, rollback ключа; **MITIGATED** | Failure injection и Android Keystore recovery integration |
| TOR-02 | P1 | 1 GiB file → тысячи одновременных запросов/посылок; зависание WebView, Tor flood | Window 128, media-send-gate, idle timeout, chunk resume and repair, IndexedDB cursor; **FIXED-CI builds 279–290** | Ограничить file read memory и очередь на стороне peer, true streaming assembly |
| TOR-03 | P1 | Завершённый/удалённый Blob мог вернуться поздними валидно подписанными chunks | Подписанный исходный manifest, lifecycle + chunk insert в одной Dexie транзакции; **FIXED-CI build-288/293** | Нагрузочные гонки cancel/purge/commit, orphan cleanup |
| TOR-04 | P1 | Native corrupted frame блокирует список pending; остаточные сбои диска | NativeInboundQueue skip unreadable, AtomicFile, bounded queue; **FIXED-CI build-279** | Нативные JUnit/Android tests, очередь под заполнением |
| TOR-05 | P1 | Подмена onion при bootstrap или stale connected indicator | Проверка опубликованной идентичности и strict isTorServiceReady; **FIXED-CI builds 277/283** | Перезапуск службы при kill, реальное установление Tor peer |
| SEC-03 | P1 | Повтор одного dispatch id в параллельных вызовах мог уйти не тому peer | sameOutgoingDispatchRoute + inFlight route guard; **FIXED-CI build-292** | Cross-tab/restart and peer-level nonce tests |
| SEC-04 | P1 | Подписанный Tor packet мог содержать malformed JSON ids/media types/control chars | inbound-frame-policy, inbound-message, validation fileId/name/MIME; **FIXED-CI build-289/292** | Случайные/fuzz payloads, native frame input bounds |
| HIST-01 | P1 | Удаление/редактирование другим peer при «Защита истории» | Receiver-side deniedByHistoryProtection, sender-side notice; **MITIGATED**, готовность 57% | Проверка offline toggle/conflicting updates and UI buttons |
| SCHED-01 | P1 | Scheduled message может навсегда зависнуть при ошибке Keystore/смене часов/сворачивании | Keystore migration, immutable scheduledAt, clock correction, visibilitychange; **FIXED-CI build-295** | При убитом WebView без native job пока **OPEN** |
| AND-01 | P1 | Устройство Android 7–17 с 3-button/gesture/IME/cutout может накрыть чат системой | MainActivity.configureSystemBars; minSdk24; **MITIGATED**, runtime matrix отсутствует | Эмулятор CI + logcat + реальные screen variants |
| AND-02 | P1 | Ошибка Native Tor JNI / неподдержанный ABI может сломать старт | TorNativeSupport lazy load, 4 ABI audit + startup diagnostic; **MITIGATED** | Device cold-start и emulator APK smoke |
| NOT-01 | P1/P2 | Утечка текста уведомления при localStorage failure | notificationPreferenceUnavailable fails closed; **FIXED-CI** ранее | Android notification preview/channel тесты |
| FILE-01 | P2 | EXIF/location, executable renamed .jpg, forged MIME | Reencode images, inspect header, reject mismatch; **MITIGATED** | Расширить content sniffing, не рекламировать antivirus |
| STT-01 | P1 product gap | Offline speech recognition fake/absent | UI явно возвращает model_not_installed; **OPEN** | Выбрать bundled CPU/mobile ASR runtime и тесты без сети |
| QA-01 | P1 | CI нет полноценного двух peer, Android emulator smoke и logcat | Unit/tsc/Android build зеленые; **OPEN** | Emulator GitHub Actions job + runtime instrumentation; без фиктивной «проверки на телефоне» |

### Важные исторические предупреждения
- Не превращать **сборку** в доказательство отсутствия Android ANR / work under battery saver / two-device Tor.
- «Удалить у себя» обязано стирать содержимое локально; собственный tombstone не удалять вместе с ним. Критический риск loss/privacy при миграциях.
- Нельзя отключать функции/permissions, чтобы формально ускорить Android: сначала найти причину, исправлять без потери пользовательских требований.
- README.md/ARCHITECTURE.md могут содержать оптимистичные утверждения «encrypted payloads»; по Dexie текущая история **не полностью шифрована**.

---

### Проверенные проблемы и исправления 2026-11-06
- **STATUS-ACK-01 / FIXED-CI builds-298/301:** DB-статусы обновляются монотонно и atomic; bounded recentDeliveryEvents + shouldEmitDeliveryEvent подавляют поздний UI sent после delivered; Vitest и APK success. Открыты независимые fault-injection integration проверки.|
- **PERF-CHAT-01 / FIXED-CI build-299:** getMessagesForChat не читает все чужие чаты; выборка по двум индексам from/to в read transaction, merge с тестами.
- **PERF-BLOB-01 / FIXED-CI build-299:** Blob cache eviction теперь идёт курсором oldest-first и не собирает массив всех Blob; не удаляет вложения, на которые ссылаются сообщения.
- **MEDIA-REF-01 / FIXED-CI build-300:** вложение может быть связано с несколькими сообщениями; удалённый parent не должен мешать приёмке файла по другому живому parent.
- **CI-ACCEL-01 / FIXED-CI build-298:** setup-java cache:gradle и GitHub Actions Bun-download cache (по bun.lock). Предыдущие workflow не пересобирать без причин.
- **Сборки:** build-298, build-299, build-300 = SUCCESS (unit, TypeScript, web, Android debug, SDK/ABI, release upload); это не тест на двух физических устройствах.


### Исправления нового проверенного пакета — 2026-11-06
- **STATUS-UI-01 / FIXED-CI build-301:** после предыдущего fix DB ещё могла прийти задержанная UI нотификация sent вслед за delivered. Внедрены bounded recentDeliveryEvents и shouldEmitDeliveryEvent; Vitest + strict TypeScript + APK прошли. Порядок интерфейсных событий теперь монотонен, остаются отдельные интеграционные испытания.
- **PERF-INBOX-01 / FIXED-CI build-302:** recoverInbox вместо `toArray()` полных шифрованных кадров получает упорядоченные первичные ключи и обрабатывает каждую запись последовательно, снижая риск WebView OOM.
- **PERF-OUTBOX-01 / FIXED-CI build-302/303:** из очереди перестали хранить одновременно весь sealed ciphertext. В build-303 выборка использует индексы peer/nextAttemptAt и сортировку метаданных, порядок createdAt сохранён. Не утверждать, что Android background sender независимо от WebView уже реализован.
- **CI:** 301 https://github.com/BauRP/project-revival-kit/actions/runs/42146398182 ; 302 https://github.com/BauRP/project-revival-kit/actions/runs/42146576834 ; 303 https://github.com/BauRP/project-revival-kit/actions/runs/42146708932 ; все success. Emulator и two-phone Tor тестов в этом запуске не было.

### 2026-11-06 — входящий Tor replay: устранение гонки (проверено builds 305–310)

- **Новый кодовый пакет:** `src/lib/inbound-frame-single-flight.ts` + `src/lib/__tests__/inbound-frame-single-flight.test.ts` и `src/lib/onion-engine.ts`: один подписанный кадр обрабатывается единожды при параллельном `acceptRawFrame` и `recoverInbox`, но ошибки IndexedDB допускают повторную попытку без потери записи/ACK. Независимые отправители не блокируют друг друга.
- `src/lib/inbound-frame-policy.ts` и тесты: проверка буквального и ограниченного id/type до базы, дедупликация ACK ID, отбрасывание control characters. Не менять wire format и правило ACK только после durable commit.
- **Проверки на этапе commit:** изменения сохраняются перед запуском GitHub Actions; наличие кода/тестов не означает success. Подтверждение, ссылка на CI и прирост будут внесены после окончания workflow. До подтверждения **готовность 37,0%, прирост 0,0**.
- P0 настоящего шифрования Dexie, PQ и офлайн STT **не затрагивали**. Следующий независимый этап: fault-injection native очереди, hardening повреждённых signed frames, затем безопасное storage encryption.

### 2026-11-06 — safety fix: transient crypto failure не удаляет Tor кадр (build-306 SUCCESS)

- **Код:** `src/lib/inbound-durability.ts`, `src/lib/onion-engine.ts`, `src/lib/__tests__/inbound-durability.test.ts`. Прежний общий catch при неудачном openFrameAsync удалял ciphertext из inbox_raw даже при временном сбое Worker или Keystore. Теперь удаляются только определённые необратимые нарушения структуры/подписи/получателя; остальные ошибки оставляют encrypted frame для replay после восстановления работы.
- Предыдущий пакет `c2bf5121` (single-flight raw frame + bounded ACK) получил **неуспешную build-304** на первоначальном тестовом варианте; исправление тестовых строк в `254dc2a2` вызвало build-305. Не объявлять этот или настоящий пакет готовыми, пока соответствующий CI не даст success.
- В code-прогресс не прибавлять ничего до успешного завершения проверки. P0 encrypted Dexie и ML-KEM по-прежнему отсутствуют.

### 2026-11-06 — проверенный пакет durable Tor / криптографическая обработка (build-310)

- **c2bf5121 / build-304 FAILED:** первичная single-flight обработка raw подписанных кадров и bounded ACK ID. Unit-тест неверно экранировал newline (тест ошибочно ожидал отказ для буквальных двух символов `\\n`). Ошибка только в тесте; за failed build не повышать готовность.
- **254dc2a2 / build-305 SUCCESS:** исправлены реальные управляющие символы в тестах. https://github.com/BauRP/project-revival-kit/actions/runs/42151444824
- **322b4bf6 / build-306 SUCCESS:** `inbound-durability.ts`, `onion-engine.ts`: при временном падении Crypto Worker, Keystore или иных runtime errors ciphertext **не удаляется** из `inbox_raw`; только достоверно плохие authentication/frame ошибки удаляются; тесты на оба случая. https://github.com/BauRP/project-revival-kit/actions/runs/42151606280
- **8c7ecc98 / build-307 SUCCESS:** `envelope.ts` strict epk/nonce/signature lengths, minimum cipher length, deterministic error `open: malformed decrypted JSON`; invalid signed payload не оставлять в бесконечном replay; тесты envelope/durability. https://github.com/BauRP/project-revival-kit/actions/runs/42151979080
- **816c062e / build-308 FAILED:** keyed serial chunk queue; тест стартовал ожидание раньше запуска первого queued task (микрозадачи). Кодовая гонка не обнаружена, исправлен тест на явный сигнал.
- **599f9542 / build-309 SUCCESS:** fixed deterministic await-start в `keyed-serial-queue.test.ts`; успешная полная APK сборка. https://github.com/BauRP/project-revival-kit/actions/runs/42152309466
- **e2f32333 / build-310 SUCCESS:** `onion-engine.ts` + `inbound-durability.ts` не позволяют другому raw frame с тем же signature-derived key перезаписать ранее сохранённый ciphertext: atomic check-and-insert в Dexie. https://github.com/BauRP/project-revival-kit/actions/runs/42152531633
- **Модули:** `src/lib/inbound-frame-single-flight.ts`, `src/lib/keyed-serial-queue.ts`, `src/lib/inbound-frame-policy.ts`, `src/lib/inbound-durability.ts`, `src/lib/envelope.ts`, `src/lib/onion-engine.ts` и 4 связанных Vitest файла. Монотонность ACK/сообщений сохранена, wire format v2 неизменен, пользовательские данные не удаляли.
- **Проверки:** все перечисленные SUCCESS = Vitest, strict tsc, web build, Capacitor sync, Gradle debug APK, SDK and Tor ABI audit, upload GitHub Release. Android emulator/physical peer tests не запускались, не выдавать их за зелёные.
- **Показатели:** общая готовность 37,0% → **37,3% (+0,3 п.п.)**; P0 local Dexie encryption/PQ/STT не реализованы и не получают прироста.

### Дополнение к реестру проблем 2026-11-06

- **TOR-REPLAY-02 / FIXED-CI 305–310 / P1:** параллельные live + recoverInbox обработки одного signed raw кадра, транзиентные падения Crypto Worker/Keystore, malicious ID collision; исправлено single-flight, сохранением raw после temporary open failure, atomic immutable first stored raw. Не путать с независимым тестом доставки между двумя реальными Android устройствами.
- **TOR-MEDIA-03 / FIXED-CI 309/310 / P1:** одновременные подписанные чанки одного fileId способны гоняться за `partialReceives`, IndexedDB и final assembly. Теперь KeyedSerialQueue сериализует **только одинаковый fileId**; другие вложения параллельны, отказ не блокирует следующую попытку.
- **QA-RETRY-02:** failed builds 304 и 308 исправлены по фактическим логам, не считать их SUCCESS; полный следующий green 310.

### 2026-11-06 — build-311: Native Tor inbox AtomicFile recovery, verified disk ACK, Java/JUnit

- **Кодовый коммит:** `5a0d45e1` — `android/app/src/main/java/com/baurp/trivochat/tor/NativeInboundQueue.java`, новый `NativeInboundQueueFiles.java`, новый `android/app/src/test/java/com/baurp/trivochat/tor/NativeInboundQueueFilesTest.java`, `.github/workflows/android_build.yml`. Изменения **только в согласованной ветке**, `main` и Lovable-managed `AGENTS.md` не затронуты.
- **Подтверждённая причина по коду (TOR-NATIVE-ATOMIC-01, FIXED-CI):** старый обход `*.frame` пропускал единственную восстановимую legacy `*.frame.bak` запись после сбоя `AtomicFile`; `FileInputStream(base)` не выполнял rollback/restore; ACK удалял только базовый файл и мог допустить replay из оставшегося backup.
- **Исправление:** проверка только допустимых SHA-256 basename файлов и `.bak`, вызов `AtomicFile.openRead()` для восстановления, повторная проверка полной длины и **всех байтов** после `finishWrite` перед сетевым ACK, `AtomicFile.delete()` для полного удаления base/backup/new. Неподтверждённый incomplete `.new` не считается принятым. Recovery, commit и ACK защищены прежним lock.
- **Проверки:** GitHub Actions `build-311` для SHA `5a0d45e153c7a4e6b03037a08040a8563ef8639f`, **completed/success**, https://github.com/BauRP/project-revival-kit/actions/runs/42165882854. Выполнены `bunx vitest run`, strict `bunx tsc --noEmit --pretty false`, web staging, `./gradlew clean testDebugUnitTest assembleDebug --no-daemon --stacktrace`, SDK min24/target36 и Tor JNI ABI audit; создана APK https://github.com/BauRP/project-revival-kit/releases/download/build-311/app-universal-debug.apk.
- **Точность доказательств:** Java JVM unit-тесты проверяют правила имён и поиск backup, но **не имитируют реальное падение Android во время fsync/rename**; реальное crash fault-injection в эмуляторе/Android пока не выполнялось. Не объявлять покрытие Android 17 или независимую фоновую отправку.
- **Метрики:** фон Tor 52,1 → **52,3%** (+0,2), защита сообщений 63,0 → **63,1%** (+0,1), тесты 69,0 → **69,5%** (+0,5), общая оценка 37,3 → **37,4%** (+0,1 п.п.). P0 шифрование Dexie и PQXDH не изменены.

### 2026-11-06 — build-312: приём общих вложений с независимо удалёнными родителями

- **Кодовый коммит:** `b3efeb6c` после успешной build-311; изменены `src/lib/onion-engine.ts`, `src/lib/message-deletion-policy.ts`, `src/lib/__tests__/message-deletion-policy.test.ts`. Ветка `chatgpt/trivo-security-compat-20261031`; `main` и `AGENTS.md` не трогали.
- **Реальный дефект:** `persistBlobChunk()` выбирал только `.first()` signed parent для одного fileId. Если первый parent имел tombstone, а второй подходящий parent был жив, приходящие verified chunks ошибочно отклонялись; предыдущие исправления `putReceivedBlob` не покрывали этап записи чанков.
- **Исправление:** выборка `toArray()` лишь среди совпадающих authenticated manifest записей; внутри прежней Dexie `rw` transaction проверяется **каждый** подходящий parent по личному deletion tombstone, и глобальный consumed one-time tombstone; разрешение только при хотя бы одном живом parent. Чужие/несовпадающие media metadata не авторизуются; отсутствие ссылок и ошибка чтения lifecycle приводят к отказу/rollback, не к «успеху».
- **Тесты:** `hasAuthorizedAttachmentParent` покрыт Vitest (первый parent удалён, второй жив; пустой/все удалены/consumed; ошибка IndexedDB не становится разрешением). Реальная Dexie transaction в этих unit тестах не запускалась.
- **CI:** **build-312 completed/success** на SHA `b3efeb6cc6ae0dfe2db8111b73ca611d32d0bbf4`, https://github.com/BauRP/project-revival-kit/actions/runs/42166428094; Vitest, strict TSC, web staging, `testDebugUnitTest`, `assembleDebug`, Android SDK/ABI audit, GitHub Release APK https://github.com/BauRP/project-revival-kit/releases/download/build-312/app-universal-debug.apk.
- **Границы:** P0 encrypted local history и PQXDH по-прежнему не реализованы; Android runtime two-phone tests не проводились. Прирост за этот пакет: направление 12 +0,1 п.п., 14 +0,1 п.п., тесты 18 +0,1 п.п., общий ПО 37,4 → 37,5%.

### 2026-11-06 — build-313–317: Android identity crash recovery and isolated future Dexie encryption foundations

- **0067e9f4 / build-313 SUCCESS:** `SecureVaultPlugin.java`, new `VaultBackupFiles.java` and 4 JUnit `VaultBackupFilesTest`. Original backup lookup checked only AtomicFile base; .bak alone after power loss was falsely treated as absent identity. Now look for .bak, restore via AtomicFile.readFully, bound sealed size and verify re-read authenticated ciphertext after save; no silent new identity. https://github.com/BauRP/project-revival-kit/actions/runs/42223710499.
- **e6a94a0d / build-314 FAILURE (TypeScript):** new `local-record-crypto.ts` and 4 Vitest passed, but `Uint8Array<ArrayBufferLike>` did not satisfy current DOM `BufferSource` typing. **328d8526 / build-315 FAILURE:** separate Android wrapping key added, still same TSC error. Both failures are recorded, NOT counted as verified completion.
- **b67d04ee / build-316 SUCCESS:** explicit ArrayBuffer-backed typed arrays in WebCrypto calls fix TypeScript; native `SecureVaultPlugin` changes compile. https://github.com/BauRP/project-revival-kit/actions/runs/42224527533.
- **c392fc36 / build-317 SUCCESS:** `src/lib/local-record-key.ts` + test: Android-only explicit master key generation/unwrap through SecureVault; wrapping uses **independent** non-exportable Android Keystore alias `trivo_local_data_aes_wrap_v1`, validates 32-byte material, refuses lost/unavailable native key with no plaintext fallback; JS codec `local-record-crypto.ts`: AES-256-GCM nonce per record and authenticated binding of table+record ID; tests for round-trip, tampering, cross-row substitution and browser fail-closed. https://github.com/BauRP/project-revival-kit/actions/runs/42224831352, universal APK https://github.com/BauRP/project-revival-kit/releases/download/build-317/app-universal-debug.apk (62616171 bytes).
- **Security boundary / CRITICAL:** none of the above automatically encrypts **existing** Dexie messages/lifecycle/contacts! No new schema/migration was enabled, so existing data stays readable and prior backup behavior is unchanged. Key adapter is an isolated component; it DOES NOT persist the wrapped key nor activate storage encryption. Next engineer must implement crash-safe persistence + migration and test all readers/writers before counting full feature; do not assert at-rest encryption is delivered.
- **Actual tests:** Vitest, TypeScript, web, Java/JUnit `testDebugUnitTest`, Gradle APK, SDK/ABI. **Not performed:** Android runtime Keystore fault-injection, physical device reinstall/restore, encrypted Dexie migration, Android 17 emulator. User device tests remain separate.
- **Estimate:** #2 19,9→20,0 (+0,1), #3 62,7→62,8 (+0,1), #18 69,6→69,8 (+0,2). Overall 37,5→**37,6%** (+0,1 п.п.). No increases for unimplemented message-at-rest encryption/PQ/STT.

### 2026-11-07 — verified build-318: durable encryption-key bootstrap and strict legacy IndexedDB transactions

- **Code commit `72eba527`** (4 files): `src/lib/storage.ts`, `src/lib/__tests__/storage.test.ts`, new `src/lib/local-record-key-store.ts`, new `src/lib/__tests__/local-record-key-store.test.ts`. Only `chatgpt/trivo-security-compat-20261031`; `main` untouched.
- **Bug, confirmed in code:** old `dbPut` and `dbDelete` caught errors and reported success; `dbGet`/ `dbGetAll` could treat failed reads as absent/empty; some connections stayed open. This is unsafe for migrations/secure settings because an aborted transaction must never be considered committed.
- **Fix:** existing callers of `dbGet`, `dbPut` and `dbGetAll` now route through strict commit-aware operations; `dbDelete` rejects on abort and resolves only on `oncomplete`; `openDB` closes on `versionchange` and errors on blocked upgrades. Introduced `dbAddStrict` with `add` instead of `put` to preserve a first-writer-wins sealed key.
- **Keystore key safety:** new `acquireProtectedStorageKey` injection-friendly policy and `acquirePersistedLocalRecordKey` adapter use legacy settings only for ciphertext wrapper. Never generate replacement key if protected records exist; recover concurrent insert winner; never mistake broken storage for empty. Actual encrypted Dexie table migration has **NOT** been activated; caller must supply a real encrypted-store emptiness check before use.
- **Tests:** Vitest added transaction commit/abort and first writer/race/lost key tests. **GitHub Actions build-318 completed/success** https://github.com/BauRP/project-revival-kit/actions/runs/42333901867: unit tests, TypeScript strict, Web staging, Java/JUnit, `assembleDebug`, SDK min24/target36 and libtor ABI audit, APK https://github.com/BauRP/project-revival-kit/releases/download/build-318/app-universal-debug.apk (62616227 bytes).
- **Security boundary:** no protected message write/read or migration of legacy plaintext Dexie. Android 7–17 device/emulator runtime and two-device Tor tests are NOT claimed. No source for earlier failed tests in this build; build-318 passed.
- **Estimated readiness:** #2 20,0→20,1% (+0,1), #18 69,8→70,0% (+0,2). Overall 37,6→**37,7%** (+0,1 p.p.), no progress on PQ/STT or unimplemented full local encryption.

### 2026-11-07 — builds 319–321: durable media-cache eviction and fileId collision defense (verified)

- **ee818173 / build-319 SUCCESS:** `src/lib/dexie-db.ts`, `src/lib/media-store.ts`, new `src/lib/media-cache-policy.ts` and Vitest tests. Previous media cache scan read messages/Blobs outside the deleting transaction, so a newly attached message could race with cache eviction and lose its file. New code validates limit and runs reference scan, Blob cursor and deletion inside one Dexie `rw` transaction. Received uploads get a one-hour grace; cancellation after commit checks all message references atomically before removing the Blob. https://github.com/BauRP/project-revival-kit/actions/runs/42372849004.
- **b89519d6 / build-320 SUCCESS:** `BlobRecord.origin?: "local" | "received"`, `putBlob` tags local, authenticated `putReceivedBlob` tags received, cache policy evicts **only received, unreferenced and aged** media. Local uploads and old backup/unknown-origin records are preserved regardless of age. No IndexedDB schema migration required because the new field is optional and not indexed. Portable backups intentionally do not trust unvalidated origin metadata and restore legacy files without it (safe conservative preservation). https://github.com/BauRP/project-revival-kit/actions/runs/42373104507.
- **a60a3da2 / build-321 SUCCESS:** `putReceivedBlob` enforces collision safety inside its existing `rw` transaction: even a correctly authenticated peer cannot replace locally uploaded or unknown legacy media by choosing a colliding fileId. Exact retransmits reuse only an existing `origin=received` blob with identical name/MIME/size; conflict returns false. Tests cover local/legacy collision and metadata changes. https://github.com/BauRP/project-revival-kit/actions/runs/42373311595.
- **Checks:** builds **319, 320, 321 all completed/success**, executing Vitest, strict TypeScript, web build/staging, Android JVM tests, Gradle universal debug APK and SDK/Tor ABI audit. Newest APK: https://github.com/BauRP/project-revival-kit/releases/download/build-321/app-universal-debug.apk (62616627 bytes).
- **Remaining limits:** pure-policy tests do not substitute for actual Dexie concurrent transaction fault-injection. The cache ceiling is best-effort, prioritizing user data over reclaim. No actual existing messages are encrypted by this work; Keystore migration remains P0. Android runtime tests not performed. User device installation is separate.
- **Metrics:** #6 63,1→63,2 (+0,1), #12 76,1→76,5 (+0,4), #14 40,3→40,4 (+0,1), #18 70,0→70,3 (+0,3). **Overall 37,7→37,9% (+0,2 percentage points).**

### 2026-11-07 — build-322–323: real encrypted partial Tor media, safe legacy migration

- **Code commits:** `1f025d9d` (build-322 SUCCESS) and `8062c852` (build-323 SUCCESS), only in `chatgpt/trivo-security-compat-20261031`. Files: `src/lib/partial-chunk-vault.ts` (new), `src/lib/legacy-chunk-migration.ts` (new), `src/lib/onion-engine.ts`, `src/lib/dexie-db.ts`, new `src/lib/__tests__/partial-chunk-vault.test.ts`, `src/lib/__tests__/legacy-chunk-migration.test.ts`.
- **Confirmed prior issue:** encrypted E2EE Tor frames were decrypted and received fragment bytes were stored in Dexie `partial_chunks.data` as plaintext; when the app was killed during a large transfer, those fragments remained readable on disk. `inbox_raw` and outbox ciphertext did not cover this table.
- **Implemented:** Android-only `sealIncomingChunk` encrypts each verified 48-KiB chunk before IndexedDB write with existing Android Keystore-wrapped AES-256 key, random GCM nonce, authenticated AAD binding `partial_chunks`/row ID. `encrypted?:1` and `plaintextSize?` are optional non-indexed fields; no destructive Dexie schema version change. Web preview behavior preserved. Keystore unavailable on Android => no plaintext fallback for new writes. `openPartialChunkBytes` detects and rejects changed keys, tampered data, unsupported versions and missing ciphertext marker.
- **Read/resume/assembly:** `onion-engine.ts` uses authenticated plaintext bytes and `persistedChunkPlainSize` for digest checks and complete-transfer assembly. Old plaintext incomplete chunks remain readable across APK upgrades; after digest verification, `upgradeVerifiedLegacyChunk` encrypts and conditionally replaces the exact current row in one Dexie `rw` transaction. If row was deleted/replaced during upgrade, it cannot be revived; crypto/disk error preserves the old row for retry. Importantly this migration is opportunistic on resume and assembly, not a claim that all historic plaintext has been erased immediately.
- **Checks:** **build-322 completed/success** https://github.com/BauRP/project-revival-kit/actions/runs/42381878762 and **build-323 completed/success** https://github.com/BauRP/project-revival-kit/actions/runs/42382095025. Both include Vitest, strict TypeScript, web build/staging, Android Java/JUnit, Gradle APK, SDK min24/target36 and libtor ABI audit. APK https://github.com/BauRP/project-revival-kit/releases/download/build-323/app-universal-debug.apk (62619019 bytes).
- **Limits:** Protected only **new Android partial received Tor media chunks**, with opportunistic migration for legacy incomplete chunks. No activation of full at-rest encryption for Dexie messages/lifecycle/contacts or completed `blobs`; portable backup behavior unchanged. Actual Keystore/WebView/Android power-loss runtime fault-injection was **not** executed. Browser preview is not protected by native Keystore and uses legacy bytes.
- **Progress:** #2 20,1→20,4 (+0,3), #6 63,2→63,3 (+0,1), #18 70,3→70,6 (+0,3). Overall 37,9→**38,1% (+0,2 п.п.)**, an estimate of verified software scope, not a count of lines or commits.

### 2026-11-07 — build-324–326: terminal message deletion protects reactions, Tor event outbox, portable restores

- **Code commits:** `ffa376bb` build-324, `8ecfd046` build-325, `d479c435` build-326, only agreed branch `chatgpt/trivo-security-compat-20261031`. **All completed/success**, not inferred: https://github.com/BauRP/project-revival-kit/actions/runs/42389490053, https://github.com/BauRP/project-revival-kit/actions/runs/42389722554, https://github.com/BauRP/project-revival-kit/actions/runs/42389925248.
- **Confirmed code problem (PRIVACY-REACT-01):** after delete-for-me the tiny message shell persisted; late authenticated peer reaction could still be accepted, local UI could toggle a deleted message, and legacy `settings/reactions-*` could show old emoji. Fix: `src/lib/reaction-deletion-policy.ts`, `src/lib/reactions.ts`, `src/lib/onion-engine.ts` require the original sender/recipient pair and absence of `deletedMessageKey` in the SAME inbound/local write transaction; old reaction view filters deleted IDs. New pure tests validate unrelated parties, tombstones, forged/dropped IDs.
- **Confirmed queue problem (PRIVACY-REACT-02):** pending signed reaction outbox entry uses `outboundEventId` not `messageId`; old local delete/remote delete for everyone erased the message but could leave pending reaction to resend after reconnect. Now local delete, chat clear/expiry and remote global delete cancel those immutable event IDs and remove corresponding lifecycle entries in one Dexie transaction. `src/lib/p2p.ts`, `src/lib/onion-engine.ts`, `queuedReactionEventIds()` and unit tests. Existing correct sender-side/receiver-side history protection stays enabled; no UI buttons were disabled.
- **Backup privacy problem (PRIVACY-RESTORE-03):** restored irreversible deletion tombstone removed message but could preserve older `editedText`, reactions, and pending reaction event IDs from existing device or backup lifecycle. `src/lib/dexie-db.ts`, `src/lib/backup-merge-policy.ts` now purge stale mutable per-message lifecycle plus queued reaction IDs within the existing all-tables restore transaction, preserving deletion/consumed tombstones. Added backup policy regression tests.
- **Checks** (three independent completed runs): `bunx vitest run`, strict `bunx tsc --noEmit`, CAP_BUILD web staging, Java/JUnit `testDebugUnitTest`, Android `assembleDebug`, SDK and Tor ABI audits, release published. Latest debug APK: https://github.com/BauRP/project-revival-kit/releases/download/build-326/app-universal-debug.apk (62619571 bytes).
- **Limits:** Unit tests cover pure policies and actual project build; emulator/Tor peer network and real Dexie fault-injection were not executed. These changes secure deletion/reactions/backup privacy only. Entire existing Dexie plaintext conversation history is **NOT** encrypted yet. Never report full local at-rest encryption completed.
- **Estimated readiness delta (not a weighted formula):** #3 +0,1, #6 +0,1, #11 +0,4, #18 +0,3, #20 +0,1; overall **38,1→38,2% (+0,1 p.p.)**.

### 2026-11-09 — builds 327–330: согласованная экспортная копия, уменьшение памяти, необратимость одноразовых вложений

- **74d3a139 / build-327 FAILURE (TSC):** добавлены `src/lib/backup-snapshot-policy.ts` и тесты, обновлён `src/lib/dexie-db.ts`. Новое требование: чтение пяти таблиц `contacts/messages/outbox/lifecycle/blobs` одним Dexie `r` snapshot, чтобы не смешать состояние до/после удаления и одноразового просмотра. После чтения и **вне** IDB transaction сверяются реальные `Blob.size`, все serializable metadata и общий бюджет V3 JSON. Ошибка компиляции была в слишком широком индексном типе описания `BlobRecord`, **не** в работе Android.
- **404e1fef / build-328 SUCCESS:** приведён тип snapshot к фактическим полям `BlobRecord`, сохранив оба защитных условия; URL https://github.com/BauRP/project-revival-kit/actions/runs/42572120263.
- **e3368147 / build-329 SUCCESS:** `src/lib/backup-media-codec.ts` и тесты, `src/lib/dexie-db.ts`: экспорт Blob в Base64 и импорт из Base64 обрабатываются порциями **96 КиБ**, а не полной медиа-копией в одном `arrayBuffer/atob`. Размер чанка кратен трём байтам, поэтому V3 JSON и архивный формат полностью совместимы со старыми backups. Тесты: бинарные границы 0/1/2/3/4, 98 304±1, 262 144 bytes, сравнение с прежним one-pass Base64; https://github.com/BauRP/project-revival-kit/actions/runs/42572283205.
- **262a2ca0 / build-330 SUCCESS:** `src/lib/backup-export-privacy.ts` + tests: из нового portable export исключается сырой Blob уже просмотренного одноразового файла, даже если старый кэш остался после crash; сообщение очищается от приватного media preview, а каноническая `consumed-media` tombstone сохраняется. Поддельный marker не считается основанием для удаления вложений. https://github.com/BauRP/project-revival-kit/actions/runs/42572631337.
- **Полные проверки**: builds 328/329/330 = completed/success, GitHub Actions Vitest, strict TypeScript, web staging, Java/JUnit, Gradle `testDebugUnitTest assembleDebug`, minSdk24/target36 и Tor ABI audit. Build-327 = FAILURE и не считался подтверждённым до исправления. APK build-330: https://github.com/BauRP/project-revival-kit/releases/download/build-330/app-universal-debug.apk (62620231 bytes).
- **Границы доказательств:** unit-тесты и APK success; реальный параллельный IndexedDB snapshot/fault injection на эмуляторе или физическом телефоне не выполнялся. V3 portable backup по-прежнему содержит plaintext ВНУТРИ внешнего AES-GCM архивного конверта. Эта работа **не зашифровала локальную историю** в Dexie и не добавила PQ. Одноразовое медиа исключается только при наличии валидного consumed tombstone. Существующие архивы не изменялись.
- **Прогресс:** #3 62,9→63,5% (+0,6 п.п.), #14 40,4→40,5% (+0,1 п.п.), #18 70,9→71,2% (+0,3 п.п.); общая оценка ПО **38,2→38,4% (+0,2 п.п.)**, не вычисляется средним по направлениям.

### 2026-11-09 — builds 331–334: Android AES-GCM собственный профиль, безопасная миграция и identity check

- **Кодовые коммиты:** `bb5183e7` (build-331 failed due to a mistaken `await` in a test), `54b302e0` (build-332 SUCCESS; test fixed), `a46868d3` (build-333 SUCCESS; reject foreign/malformed persisted profile), `5e3bd75b` (build-334 SUCCESS; verify identity before deleting old plaintext).
- **Файлы:** `src/lib/profile.ts`, `src/lib/protected-local-profile.ts` (new), `src/lib/protected-record-inventory.ts` (new), `src/lib/partial-chunk-vault.ts`, `src/lib/storage.ts`, `src/lib/__tests__/protected-local-profile.test.ts` (new). Старый Lovable-managed `AGENTS.md` и `main` не изменялись.
- **Реальное поведение:** Android хранит локальное имя, avatar, status и customStatus профиля в versioned AES-256-GCM ciphertext (`my-profile-sealed-v1`) через уже существующий Keystore-wrapped AES master key; AAD жёстко связывает запись с таблицей/ключом. Web preview остаётся с прежним хранением. `profile.ts` теперь пользуется зашифрованным адаптером, `saveMyProfile` уведомляет слушателей только после подтверждённого сохранения.
- **Общая безопасность ключа:** `protected-record-inventory.ts` учитывает зашифрованный профиль и зашифрованные `partial_chunks` перед созданием master key; пропажа Keystore wrapper не приводит к тихой смене ключа и потере обоих наборов данных. `partial-chunk-vault.ts` использует тот же single-flight. При явном `nukeAllData` очищается кэш ключа в памяти.
- **Crash-safe legacy:** прежний `my-profile-v1` сохраняется до подтверждённого `dbPutStrict` ciphertext, нового `dbGetStrict`, аутентифицированной дешифровки, точного сравнения полей и совпадения Tor identity; только тогда вызывается `dbDelete` plaintext. При аварии после записи старую копию можно удалить на следующем запуске. Повреждённый или принадлежащий другой личности профиль не превращается молча в пустой профиль. Тесты покрывают ключ/nonce/tamper, ошибки записи, раннее удаление, mismatch identity, возобновление без legacy.
- **CI:** build-331 failed **unit test transform** (test `await` outside async function), not app code. Исправлено commit `54b302e0`. Проверенные завершённые сборки: build-332 https://github.com/BauRP/project-revival-kit/actions/runs/42593636860, build-333 https://github.com/BauRP/project-revival-kit/actions/runs/42594068919, build-334 https://github.com/BauRP/project-revival-kit/actions/runs/42594433277. В каждой полный набор Vitest, TypeScript, Web, Java/JUnit, Android APK и SDK/Tor ABI audit = SUCCESS. Последняя APK https://github.com/BauRP/project-revival-kit/releases/download/build-334/app-universal-debug.apk (62621291 bytes).
- **Границы:** защищён ТОЛЬКО собственный профиль в legacy IndexedDB settings (не все кешированные/чужие contact metadata); `dxdb.messages`, `dxdb.lifecycle`, `dxdb.contacts`, готовые media blobs и legacy chat metadata остаются plaintext. Реальный Android-runtime/Keystore reinstall/kill не тестировались, в CI только unit/Java/Android APK. Нельзя объявлять закрытым направление №2; профиль-синхронизацию №10 не увеличивать за локальное шифрование.
- **Готовность:** #2 20,4→20,7 (+0,3 п.п.), #18 71,2→71,4 (+0,2 п.п.); общая оценка **38,4→38,5% (+0,1 п.п.)**, независимая от простого среднего.

### 2026-11-10 — build-335: защита от потери данных при миграции собственного профиля

- **Коммит:** `6e809d2391668d445372757caa1ee540431c8e6d`, **GitHub CI build-335 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42708814516. Изменены `src/lib/storage.ts`, `src/lib/protected-local-profile.ts`, `src/lib/__tests__/storage.test.ts`, `src/lib/__tests__/protected-local-profile.test.ts`.
- **Устранённый риск:** раньше подтверждённая зашифрованная копия могла привести к безусловному удалению legacy-профиля, который другой экземпляр приложения изменил между чтением и удалением, либо который принадлежал другой identity. Теперь `dbDeleteIfUnchangedStrict` проверяет ожидаемые данные и удаляет в **одной readwrite IndexedDB транзакции**; несовпадение/abort является ошибкой и ничего не удаляет.
- **Защита сохранения:** Android перед записью нового зашифрованного профиля проверяет идентичность legacy и существующего ciphertext; повреждённые/чужие записи нельзя тихо перезаписать. При продолжении миграции владелец legacy проверяется перед удалением.
- **Регрессии и CI:** Vitest тесты на другую identity, повреждённый encrypted profile, изменённый legacy и abort транзакции; GitHub Actions completed/success для unit, strict TS, Web, Android JVM/APK, SDK/ABI audit и Release upload. Runtime на устройстве пользователя не проверялся.
- **Границы:** **НЕ** реализованы полное шифрование Dexie, устранение гонок между независимыми одновременно записывающими encrypted копиями, Android kill/restart instrumentation. Защита ограничена собственным профилем и подтверждёнными сценариями. #2 **20,7→20,8%** (+0,1), #18 **71,4→71,5%** (+0,1); общая оценка **38,5→38,6%** (+0,1 п.п.).

### 2026-11-10 — build-336: защита локального профиля от параллельного редактирования

- **Коммит:** `d44c5879afb96b00dc4d4ce1d5c561604c77f72b`, GitHub Actions build-336: https://github.com/BauRP/project-revival-kit/actions/runs/42733659020, **completed/success**.
- **Изменения кода:** `src/lib/storage.ts` — `dbPutIfUnchangedStrict` сравнивает ожидаемое содержимое с текущим и записывает только внутри одной readwrite IDB transaction. Конфликт отклоняется, ошибка abort не маскируется.
- **Профиль:** `src/lib/protected-local-profile.ts` — `assertProfileSnapshotUnchanged` сравнивает сохранённые поля с тем, что читал вызывающий экземпляр; `assertLegacyProfileNotNewer` запрещает удалять более свежую или равную по времени, но конфликтную legacy-копию при миграции. `src/lib/profile.ts` передаёт предыдущее подтверждённое состояние в save.
- **Тесты:** расширены `src/lib/__tests__/storage.test.ts` и `src/lib/__tests__/protected-local-profile.test.ts`: конфликты и abort, stale memory, отсутствие данных на первом запуске, старые/newer/conflicting legacy записи. CI: Vitest, strict TypeScript, Web, Android JVM и APK, Tor ABI/Android SDK audit, Release upload успешны.
- **Границы:** все сообщения/contacts/lifecycle/готовые media Dexie по-прежнему plaintext. Результаты подтверждены CI, а не Android runtime на устройстве. #2 20,8→20,9 (+0,1), #18 71,5→71,6 (+0,1); **общая 38,6→38,7% (+0,1 п.п.)**.

### 2026-11-10 — build-337: шифрование краткой информации о чатах в Android legacy IndexedDB

- **Кодовый коммит:** `4a1dfcaddd4e68e97819c33b05681a2748fb03d9`; GitHub Actions **build-337 completed/success**: https://github.com/BauRP/project-revival-kit/actions/runs/42826660344. Универсальная APK: https://github.com/BauRP/project-revival-kit/releases/download/build-337/app-universal-debug.apk.
- **Реально защищённые данные:** `src/lib/protected-chat-meta.ts` шифрует Android-only метаданные `trivo-chat/contacts`, включая `friendName`, `friendAvatar`, `lastMessage`, unread и другие поля. Открытым остаётся только ключ lookup `friendId`. Данные сохраняются как версионированный authenticated AES-256-GCM envelope, AAD включает `contacts` и `friendId`; ключ через общий Android Keystore wrapper. В браузерном превью сохранён прежний формат.
- **Совместимая миграция:** старый `ChatMeta` читается и валидируется, на Android атомарно заменяется только при совпадении исходной записи `dbPutIfUnchangedStrict`, затем заново читается и аутентифицируется до возврата. Подмена/повреждение зашифрованной записи не маскируется plaintext; readAll расшифровывает ограниченными партиями по 8. `p2p.ts` переведён на adapters сохранения/чтения.
- **Lost-key fail-closed:** `src/lib/protected-record-inventory.ts` перед генерацией общего master key проверяет также legacy контакты на наличие sealed/unknown envelope. Потеря Keystore wrapper не должна тихо породить новый ключ при наличии ciphertext.
- **Проверки:** `src/lib/__tests__/protected-chat-meta.test.ts` содержит 5 сценариев: confidentiality, row swap/tamper/wrong key/version, malformed metadata, durable failure и lost-key inventory. GitHub CI SUCCESS на exact code SHA: Vitest, TS, Web, Android JVM/APK, SDK/ABI audit и публикация релиза.
- **Границы:** защищён **только дополнительный Android список чатов** и ранее уже защищённые профиль и временные Tor чанки; сами `dxdb.messages`, `dxdb.contacts`, `dxdb.lifecycle`, `dxdb.blobs`, старые message previews в других возможных ключах и Android runtime cold restart **не** считаются закрытыми. Прежние backup форматы не менялись. #2 **20,9→21,4% (+0,5)**; #18 **71,6→71,8% (+0,2)**; общая оценка **38,7→38,9% (+0,2 п.п.)**.

### 2026-11-10 — build-340: устранение конфликта установки APK (Android PackageInstaller STATUS_FAILURE_CONFLICT 5)

- **Пользовательский симптом:** «Не удалось установить, код ошибки 5» в Android-эмуляторе. Android **PackageInstaller.STATUS_FAILURE_CONFLICT = 5**, в том числе из-за разных сертификатов уже установленного и нового приложения. Источник: https://developer.android.com/reference/android/content/pm/PackageInstaller . **Точный код adb INSTALL_FAILED_... с устройства пользователя неизвестен**, так что реальную причину его конкретной установки нельзя считать подтверждённой.
- **Подтверждённые проблемы кода сборки:** `android/app/build.gradle` использовал `versionCode 1` для каждой APK; `.github/workflows/android_build.yml` не закреплял debug signing key на новом временном GitHub runner. Android требует совместимые сертификаты для in-place update. Теперь `TRIVO_VERSION_CODE=github.run_number` (340 в build-340), cache-backed private debug keystore `~/.android/debug.keystore` одинаковый начиная с build-338, concurrent builds сериализованы; при пропаже сохранённого сертификата сборка **блокируется**, а не подписывается несовместимым новым.
- **Проверка APK:** `apksigner verify --print-certs`, `unzip -tqq`, `aapt dump badging` версии/minSDK/targetSDK, наличие 4 Tor ABI. Эмулятор Android API 35 x86_64 с KVM через `reactivecircus/android-emulator-runner@v2`; `.github/scripts/verify-apk-install.sh` выполняет `adb install`, `adb install -r`, повторно проверяет существование app-private файла. **Build-340 completed/success**: https://github.com/BauRP/project-revival-kit/actions/runs/42836974205. Кодовый коммит: `d4f8948edb5475dd900c567cb618257df4a68926`. Проверенная APK: https://github.com/BauRP/project-revival-kit/releases/download/build-340/app-universal-debug.apk.
- **Точный разбор красных сборок:** **build-338 FAILURE** из-за `android-emulator-runner` executing multiline `script` as separate shells (`$APK` пустой). **build-339 FAILURE** после фактического `adb install Success`, из-за относительного пути к тестовому файлу private data. В build-340 оба багa проверочного сценария исправлены. **Последний CI успешен; красные сборки не выдавать за APK.**
- **Границы:** ни приложение в пользовательском эмуляторе, ни наличие старого пакета/его сертификат, ни причина сообщения в конкретном APK-install UI не прочитаны. APK build-337 и более ранние могли быть подписаны иным debug key; **без старого приватного ключа нет безопасного бесшовного обновления**. Удаление `com.baurp.trivochat` стирает локальные Tor identity/chat keys, сообщения, вложения: сначала сохранить/проверить резервную копию, если данные важны. Постоянство key через Actions cache **не гарантия хранения на годы** (cache может быть удалён), для долгосрочной релизной подписи нужен отдельный защищённый GitHub secret/keystore вне открытого кода. CI проверяет reinstall той же APK, НЕ переход между двумя разными релизами и НЕ полную работу всех функций Android.
- **Пересмотр дерева репозитория:** GitHub tree содержит 391 versioned files (~2,6 MB исходников). Проверены связанные Gradle/Manifest/Capacitor, workflow, scripts, key & ABI paths, результаты CI и Android PackageInstaller docs; это **не утверждение** о построчном ручном аудите всех 391 файлов. Независимых подтверждённых installation-blocking дефектов в других модулях не обнаружено.
- **Готовность:** #18 **71,8→72,1% (+0,3)**; #19 **18,8→19,2% (+0,4)**; общая **38,9→39,0% (+0,1)**. Остальные направления без изменений, направление #13 приостановлено.

### 2026-11-10 — builds 341–344: автоматический построчный аудит всего Git-репозитория + исправления потери данных и памяти

- **Исходный HEAD:** `84b1485d84ab457be8c17a3f24f53cef95191fb9` (документация build-340). Кодовые коммиты `b88814c0` (сканер), `c7130d32` (потеря контактов и аудиоволна), `fc9d4fb8` (ESLint full audit) и `915fd1ae3eaa8bafaf598c64ac95e1dbfc40c44b` (close late blocked IDB). Текущая проверенная **build-344 SUCCESS**: https://github.com/BauRP/project-revival-kit/actions/runs/42845937094. Также builds 341/342/343 completed/success.
- **Воспроизводимая проверка всего tracked tree:** `scripts/audit-repository.mjs` из CI читает **396/396 файлов Git**, **377 текстовых (42 955 строк)**, **19 бинарных**, без ошибок чтения/UTF8, записывает SHA256, место каждого совпадения, контрольные заголовки PNG/JAR/ICO и JSON-отчёт. Считает опасные pattern candidates, не объявляя их уязвимостями. `.github/workflows/android_build.yml` загружает результаты как `trivo-repository-audit-344` (включает `repository-audit.json`, `eslint.json`).
- **ESLint:** 312 файлов, **2 494 ошибок и 16 warnings**, из них **2 423 замечания Prettier (форматирование)**, **41 `no-explicit-any`**, **18 `no-control-regex`** (по большей части намеренные проверки управляющих символов), **7 пустых catch** и прочие. Это накопленные замечания кода/стиля, а не 2 494 подтверждённых функциональных ошибок. ESLint collected report-only; типы компилируются. Не было рискованного массового изменения функционального кода ради форматирования.
- **Подтверждённый дефект №1:** `src/lib/storage.ts` при старом v1→v2 IndexedDB мигрировал `contacts` через `deleteObjectStore` без сохранения, что могло безвозвратно удалить список контактов. `upgradeLegacyContactsStore` теперь перечисляет старые ключи/values и переносит в одном upgrade transaction; без успешного чтения старую таблицу не удаляет. `src/lib/__tests__/storage.test.ts` регрессии old-compatible, inline legacy, failure.
- **Подтверждённый дефект №2:** `src/components/AudioWaveformPlayer.tsx` для графика волны мог делать `fetch(src)` по внешнему URL, `response.arrayBuffer()` без лимита, decode в WebView без `AudioContext` cleanup и React rerender на каждом rAF. Добавлен `src/lib/waveform-policy.ts` (same-origin/local URL, 8MiB limit, streaming + AbortController), очистка AudioContext, capped waveform sampling и `timeupdate` вместо 60fps React. Воспроизведение audio не отключено; большой файл получает визуальный fallback. `src/lib/__tests__/waveform-policy.test.ts` тесты.
- **Подтверждённый дефект №3:** `openDB()` после `onblocked` мог получить поздний `onsuccess` и оставить открытую IDB связь, хотя Promise уже rejected, тем самым блокируя будущие upgrades. Теперь позднюю связь закрывает, добавлен тест.
- **Верификация:** Vitest, strict TypeScript, Web, Android JVM/APK, apksigner, SDK/4 Tor ABI, реальная install/reinstall через ADB на Android 15 x86_64, completed/success в build-344. Не заявлять полноценное runtime-тестирование базы v1 на старом устройстве: тестировалась модель курсора/миграции и сборка, не исторический образ установки.
- **Неустранённые и известные ограничения:** full Dexie at-rest plaintext, отсутствие PQXDH/реальной STT/полного independent Tor sender, зависимость от Google Fonts вне Tor, накопленные ESLint warnings/style debt, отсутствие ручной ревизии семантики всех 42 955 строк; дополнительное on-device and multi-peer testing не является программной незавершённой задачей. Автоматический 100% охват *файлов* не равен гарантии 100% безопасности *кода*.
- **Метрики:** #2 21,4→21,6% (+0,2), #12 76,5→76,7% (+0,2), #18 72,1→72,5% (+0,4), #19 19,2→19,3% (+0,1), **в целом 39,0→39,2% (+0,2 п.п.)**. Остальные 16 направлений не менялись. Жалобы #13 строго на паузе.

### 2026-11-10 — builds 345–346: исправления биометрии и подписок контактов по итогам аудита

- **Кодовые коммиты:** `7000f18598c802c01f13e4dc2bd6b9cfbba0451f` (shared biometric state, contact subscription fixes, тесты) и `4135ab392cc6e18f4f306b4467a67705db61f4f5` (запрет фиктивного включения биометрии в браузере и на неподдерживаемом Android).
- **Проблема №1, security:** `src/hooks/useBiometricAuth.ts` имел собственные useState на каждом экране, так что включение в Settings не передавалось в Index и стартовал unprotected frame до эффекта. Теперь `src/lib/biometric-state.ts` хранит общее состояние с `useSyncExternalStore`, initial native biometric lock выставляется синхронно; один App lifecycle listener re-lock при возвращении; несостоявшаяся аутентификация не снимает замок. Browser/no BiometricAuth/no enrollment/persistence-error не могут объявить защиту включённой. **Граница:** один режим старого web preview и физическую проверку датчика/Android process death CI отдельно не подтверждает; заблокированный Android с недоступной биометрией всё ещё требует пользовательской процедуры восстановления, не снимать lock ради удобства.
- **Проблема №2, consistency:** `src/components/FriendsList.tsx` использовал `useEffect([friends.length])`: при замене контакта с сохранением длины старые подписки оставались, новые не ставились. `src/lib/contact-subscriptions.ts` формирует стабильный ключ множества ID и удаляет частично созданные listeners при ошибке. Ошибку `dbDelete("contacts", id)` при удалении больше не маскирует успешным уведомлением и исчезнувшей строкой. `src/components/ChatRoom.tsx` регистрирует обработчик новых сообщений с актуальным `name`, чтобы уведомления не показывали имя предыдущего собеседника.
- **Автоматические тесты:** `src/lib/__tests__/biometric-state.test.ts` (3 сценария: native first-paint lock, shared updates, ignore no-op/locked until success), `src/lib/__tests__/contact-subscriptions.test.ts` (3: same-count identity changes, exact cleanup, failed setup rollback).
- **Проверки:** build-345 https://github.com/BauRP/project-revival-kit/actions/runs/42852449980 и окончательная **build-346** https://github.com/BauRP/project-revival-kit/actions/runs/42852678314 прошли `completed/success`: full Vitest, strict TS, Web, Gradle Android/JVM, verified APK signature, 4 Tor ABI, Android 15 x86_64 install/reinstall + persisted private file. Публичная APK: https://github.com/BauRP/project-revival-kit/releases/download/build-346/app-universal-debug.apk. Сборка НЕ подтверждает успешную реальную биометрическую аутентификацию на телефоне, но кодовый пакет и тесты завершены.
- **Оставшиеся известные проблемы:** full at-rest encryption Dexie messages/lifecycle/contacts/media, ML-KEM/PQXDH, background native sender и offline STT. Отдельно потребуется проверить политику восстановления биометрии, когда устройство перестало поддерживать ранее включённую аутентификацию. Пользовательское тестирование APK отдельно от программного процента. Report/жалобы (#13) на паузе.
- **Готовность:** #10 26,8→26,9 (+0,1); #17 66,5→66,7 (+0,2); #18 72,5→72,7 (+0,2); **общая 39,2→39,3% (+0,1 п.п.)**. Остальные направления без изменения.

### 2026-11-11 — builds 347–348: защита сводок чатов от гонок и потери непрочитанных

- **Код:** `86772aa486acb902f64b8fab948c3d191ae8854b` и `8ffaa88da86195bf30b99bf219a7645d6585bfe5`; рабочая ветка не менялась, main не затронута. Проверенный GitHub CI **build-348 completed/success**: https://github.com/BauRP/project-revival-kit/actions/runs/42941940182. CI build-347 также success: https://github.com/BauRP/project-revival-kit/actions/runs/42941785072. APK: https://github.com/BauRP/project-revival-kit/releases/download/build-348/app-universal-debug.apk.
- **Реальная неисправность:** входящие события могли почти одновременно прочитать один и тот же `ChatMeta.unread`, затем перезаписать каждое другое; исходящее сообщение/forward/profile updates могли записать устаревший `ChatMeta` и обнулить unread/аватар или заменить свежую сводку более старой.
- **Исправление:** `src/lib/protected-chat-meta.ts` получил `mutateStoredChatMeta` (versioned encrypted chat metadata: read, validate, AES-GCM, atomic `dbPutIfUnchangedStrict`, до 6 попыток **только** при точном `ConcurrentProtectedWriteError`; потерянный ключ, повреждённый ciphertext, quota/abort — не маскируются). Предыдущие read-only/legacy adapters и браузерный preview сохранены. `src/lib/chat-meta-policy.ts` сравнивает timestamp, optional latest message ID, сохраняет unread и аватар.
- **Пути UI:** `src/pages/Index.tsx` использует incoming merge, `src/components/ChatList.tsx` отметку прочитанного пишет CAS, `src/components/ChatRoom.tsx` отправка/бот/forward используют outgoing merge без обнуления unread; `src/lib/profile.ts` аватар/имя меняет через merge, `src/components/AddFriend.tsx` не создаёт пустую запись поверх существующей. `src/lib/p2p.ts` наблюдает rejected Promise асинхронных слушателей.
- **Dexie:** `src/lib/dexie-db.ts` обновляет контакты в одной транзакции, не затирая `lastSeen`, и не позволяет более ранней отметке времени откатить последнюю. Полная история сообщений `dxdb.messages`, `dxdb.lifecycle`, `dxdb.contacts`, `dxdb.blobs` на диске **ещё не шифруется полностью**, считать P0 open.
- **Тесты:** `src/lib/__tests__/chat-meta-policy.test.ts` проверяет concurrent-style последовательный merge, out-of-order preview, idempotent latest replay, outgoing preservation, validation. `src/lib/__tests__/storage.test.ts` проверяется сравнение защищённого значения в одной IDB-транзакции. **CI**: Vitest, TypeScript, Web, Java/Gradle APK, подпись/SDK/4 Tor ABI, Android 15 x86_64 install/reinstall green. CI не является доказательством полноценного Tor соединения двух физических устройств.
- **Ограничения:** lastMessageId защищает немедленный повтор последнего сообщения; очень старый replay вне последнего ID не гарантируется устранённым на уровне ChatMeta, основная таблица messages имеет собственную dedupe. Не заявлять полного end-to-end/глобального шифрования базы без migration всех прямых readers/writers/backup.
- **Метрики (готовность, п.п.):** #2 **21,6→21,7 (+0,1)**, #6 **63,4→63,6 (+0,2)**, #10 **26,9→27,0 (+0,1)**, #18 **72,7→72,9 (+0,2)**, общая оценка **39,3→39,5 (+0,2)**. Другие направления без прироста. #13 остаётся на паузе.

### 2026-11-11 — builds 349–351: atomic friend requests and accepted/declined replay safety

- **Подтверждённая ошибка:** входящий подписанный Tor `friend_request` в `onion-engine.ts` выполнял `dbGetStrict` отдельно от `dbPutStrict`, а local accept/outgoing status имели тот же риск. При параллельных WebView/старом signed replay поздний pending мог перезаписать accepted, duplicate инициировал повторное UI событие. **После:** `src/lib/legacy-setting-cas.ts` применяет `dbPutIfUnchangedStrict` (атомарный read/compare/write IndexedDB), максимум 6 повторов только по `ConcurrentProtectedWriteError`, fail-closed при quota/abort.
- **Исправленные пути:** `src/lib/onion-engine.ts` сохраняет friend_request/status в legacy settings с CAS и ставит `fresh` только для нового committed изменения; ACK остаётся после commit обеих баз. `src/lib/sync/peer-sync.ts` сохраняет принятый статус через CAS, исходящие запросы не перезаписывают accepted, повторное приглашение после declined разрешено, listener прекращает работу после unmount и не оставляет unhandled startup read rejection.
- **Новые тесты:** `src/lib/__tests__/legacy-setting-cas.test.ts`: concurrent writer conflict, accepted/declined replay, old/duplicate pending request, quota error no retry, exhaustion after 6 conflicts, atomic acceptance. Полноценное межустройственное Tor взаимодействие этим CI не доказывается.
- **CI:** build-349 failed at strict TypeScript из-за расширения `status: "accepted"` в новом тесте; тест исправлен коммитом `301f2735`. Build-350 https://github.com/BauRP/project-revival-kit/actions/runs/42962674632 completed/success; последняя build-351 https://github.com/BauRP/project-revival-kit/actions/runs/42963081725 **completed/success** на `4c517017e0dcbd9d0339f6bdc1f05e4a3abe3066`. Проверены Vitest, strict TS, web, Gradle/JVM Android APK, подпись, SDK/4 Tor ABI, Android 15 x86_64 install/reinstall с сохранением тестовых файлов. APK: https://github.com/BauRP/project-revival-kit/releases/download/build-351/app-universal-debug.apk.
- **Ограничения:** это исправления обмена приглашениями, НЕ полная реализация шифрования основной Dexie истории, независимого от WebView Tor или PQ; направление #13 жалобы/репорты строго на паузе. Android 17/реальная сеть двух устройств не заявляются.
- **Метрики:** #5 52,3→52,4 (**+0,1 п.п.**); #10 27,0→27,2 (**+0,2**); #18 72,9→73,1 (**+0,2**). Общая программная готовность 39,5→39,6 (**+0,1 п.п.**); другие направления не изменены.

### 2026-11-12 — build-352: Android AES-GCM для имён контактов в основной Dexie

- **Кодовый коммит:** `7633c943e54a85c54bd2079af8859e79303cd49d`; проверенный workflow **build-352 completed/success**: https://github.com/BauRP/project-revival-kit/actions/runs/43275104233. Universal debug APK: https://github.com/BauRP/project-revival-kit/releases/download/build-352/app-universal-debug.apk.
- **Защита на диске:** `src/lib/dexie-contact-protection.ts` представляет имя контакта в `trivo-p2p/contacts` в виде версионированного AES-256-GCM ciphertext под Android Keystore-wrapped data key. AAD = `dexie_contacts` + primary onion ID; подмена строки/ключа/версии отвергается. Открытыми остаются onion, lastSeen и addedAt для маршрутизации и индексов. В web preview данные остаются в прежнем формате.
- **Перенос старых записей:** `src/lib/dexie-db.ts` использует `updateContact` со строгим read/decrypt/verify перед записью и повторным чтением внутри одной Dexie readwrite transaction; при изменении записи другим экземпляром повторяет попытку не более шести раз. Запись encrypted готовится и аутентифицируется ДО IndexedDB транзакции. `getAllContacts` переносит plaintext имена ограниченными партиями, без удаления данных при ошибке. `setContactLastSeen` меняет только открытый timestamp.
- **Резервные копии:** `exportDexieDump` расшифровывает protected contact name после согласованного snapshot и помещает обычное поле `displayName` только ВНУТРЬ уже существующей шифрованной V2/V3 password backup. `importDexieDump` шифрует импортируемые имена ключом принимающего Android устройства ДО транзакции; существующие контакты не затираются. Формат портативного dump не менялся.
- **Lost-key fail-closed:** `src/lib/protected-record-inventory.ts` перед созданием нового Keystore master key учитывает также encrypted `dxdb.contacts` строки, включая повреждённые версии envelope с полем protectedName. Ключ при существующем ciphertext молча не заменяется.
- **Проверки:** `src/lib/__tests__/dexie-contact-protection.test.ts` 5 тестов: имя не в plaintext, AAD/row swap/corrupt/wrong key, legacy records, записи без имени, изменившийся snapshot. CI build-352 SUCCESS: Vitest, strict TS, Web, Android JVM/APK, SDK/4 Tor ABIs, signature, Android 15 emulator adb install/reinstall с сохранённым app-private файлом.
- **Точная граница:** полное `dxdb.messages`, `dxdb.lifecycle`, `dxdb.blobs` и прочие дополнительные поля `dxdb.contacts` **не** шифруются полностью. Lazy migration запускается при работе через контактные адаптеры, не утверждать, что все старые строки перенесены сразу. Реальные Android Keystore cold restart/cross-device recovery и concurrent IndexedDB fault-injection не проверены на устройствах. Не приравнивать успешную сборку APK к полному тесту миграции в старой установленной базе.
- **Оценка готовности:** #2 **21,7→22,2% (+0,5)**; #3 **63,5→63,6% (+0,1)**; #18 **73,1→73,3% (+0,2)**; общая **39,6→39,8% (+0,2 п.п.)**. Все прочие направления без прироста, #13 жалобы строго на паузе.

## 7. Журнал фактической разработки и GitHub CI

**Все указанные SHA — коммиты в рабочей ветке.** Ниже приоритет недавним пакетам, полезным для следующего запуска, без переписывания переписки.

| Дата (по времени разработки) | Коммит / сборка | Пакет, связанные файлы | Подтверждение |
|---|---|---|---|
| 2026-11-12 | **7633c943** / **build-352** | Android Dexie contacts AES-GCM name encryption, legacy CAS migration, V3 backup portability, lost-key detection, tests | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/43275104233 |
| 2026-11-11 | **4c517017** / **build-351** | Atomic signed friend requests/status CAS, replay and accepted/declined preservation; regression tests | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42963081725 |
| 2026-11-11 | **301f2735** / **build-350** | Fix new regression test literal type; full Android CI green | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42962674632 |
| 2026-11-11 | **077df469** / **build-349** | Initial incoming friend CAS; strict TypeScript failed on test type | **FAILURE**, fixed in 350 |
| 2026-11-11 | **8ffaa88d** / **build-348** | CAS-safe encrypted chat summary mutations, replay/old-preview policy, outgoing/contact atomic merges and regression tests | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42941940182 |
| 2026-11-11 | **86772aa4** / **build-347** | CAS-safe encrypted summaries for incoming events and unread counters | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42941785072 |
| 2026-11-10 | **4135ab39** / **build-346** | Single fail-closed biometric lock across screens; ID-based contacts subscriptions and regression tests | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42852678314 |
| 2026-11-10 | **7000f185** / **build-345** | Initial shared biometric and contacts lifecycle fixes | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42852449980 |
| 2026-11-10 | **915fd1ae** / **build-344** | Full tracked tree and ESLint inventory; v1 contacts migration, waveform bounds and DB onblocked orphan cleanup | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42845937094 |
| 2026-11-10 | **c7130d32** / **build-342** | Preserve legacy contacts, bound waveform memory and React update rate, regression tests | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42845037842 |
| 2026-11-10 | **b88814c0** / **build-341** | Repeatable tracked-file scan of repository including all text lines and binary magic | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42844071615 |
| 2026-11-10 | **d4f8948e** / **build-340** | Stable CI emulator debug signing + versionCode, Android 15 adb install/reinstall/data smoke, signature/ABI | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42836974205 |
| 2026-11-10 | **17d138be** / build-338 | Added stable signing, versionCode, emulator action; initial test script shell scope broken | **FAILURE**; corrected in 339 |
| 2026-11-10 | **ac1fc2ee** / build-339 | Real emulator `adb install Success`; smoke test app-data path incorrect | **FAILURE**; corrected in 340 |
| 2026-11-10 | **4a1dfcad** / **build-337** | Keystore AES-GCM Android chat-list metadata, lazy encrypted migration, lost-key inventory, 5 new regression tests | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42826660344 |
| 2026-11-10 | **d44c5879** / **build-336** | Concurrent encrypted-profile overwrite prevention, stale-memory conflict and newer legacy retention, Vitest | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42733659020 |
| 2026-11-10 | **6e809d23** / **build-335** | Atomic conditional legacy-profile deletion, foreign/corrupt profile rejection and regression tests | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42708814516 |
| До 2026-11-04 | **c261383d** / build-275 | Исходная подтверждённая точка нового чата; парные исправления identity/backups/native Tor/file handling, без main | GitHub Actions build-275 успешна |
| 2026-11-04 | 27f48174, 60659c59, 6977d073, **8cec0067** / build-276–279 | Bounded Tor media retry, security-scan, native inbound; был неудачный build-278, исправлен в последующем build-279 | **279 success**; 278 failure, не объявлять успешным |
| 2026-11-04 | **83b8690c**, **04d162b2** / build-280–281 | Idle timeout длинной передачи, monotonic performance.now вместо wall clock | 280/281 success |
| 2026-11-04 | **100040b5**, **ce13a65f** / build-282–283 | Tor status strict/valid v3 onion, foreground reconnect | 282/283 success |
| 2026-11-04 | **7e7a6bdc** / build-284 | Backup *.pending → rename после записи | 284 success |
| 2026-11-05 | **30102e78** / build-285 | Incoming media metadata/header checks + retry auto backup after clock change | 285 success |
| 2026-11-05 | **9f012fef** / build-286 | Bounded initial Tor media send windows | 286 success |
| 2026-11-05 | **82e2a309** / build-287 | Start at first missing chunk and repair invalid partial chunk | 287 success |
| 2026-11-05 | **4c9a1439** / build-288 | Verified source message before accepting chunk manifest | 288 success |
| 2026-11-05 | **6c8fb950** / build-289 | No coercion of untrusted signed Tor IDs | 289 success |
| 2026-11-05 | **be7059e8** / build-290 | Indexed cursor for per-chunk media permission; do not materialize entire peer chat | 290 success; APK 62.6MB |
| 2026-11-05 | **f0b8aeec** / build-291 | Monotonic delete/consumed tombstones on backup import, duplicate lifecycle marker validation; dexie-db/backup-merge-policy | 291 success |
| 2026-11-05 | **4c925cd3** / build-292 | Tor dispatch in-flight identity routing, rejects unsafe incoming attachment ids/type/path; inbound-message/onion-engine | 292 success |
| 2026-11-05 | **a903c195** / build-293 | Atomic lifecycle authorization before writing late partial Tor chunk; onion-engine/message-deletion-policy | 293 success |
| 2026-11-05 | **d1c90bd0** / build-294 | Sequential Blob import within restore transaction; no duplicate backup IDs; dexie-db/backup-validation | 294 success |
| 2026-11-05 | **4e97ba75** / **build-295** | Scheduled message clock correction and foreground recheck; scheduled-policy/outbox | **295 success**, exact SHA 4e97ba75f73418e38bafa31ad84c20f7f42225d7 |
| 2026-11-06 | **d4d596ce** (docs) | Создан постоянный PROGRESS.md на базе 4e97ba75 | GitHub файл прочитан после push, изменён только PROGRESS.md; **без прироста готовности** |
| 2026-11-06 | **80ec8d51** (docs) | Правило при каждом запросе обновлять PROGRESS.md | Документ сохранён, прирост кода 0 |
| 2026-11-06 | **b78dea2f** / **build-298** | src/lib/onion-engine.ts, p2p.ts, delivery-status-policy.ts и тесты; защита от отката статуса при ACK, CI caches | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42145196304 |
| 2026-11-06 | **6ad5a0b7** / **build-299** | dexie-db.ts, p2p.ts, conversation-index-policy.ts и тесты; индексированный чат и курсор Blob-кэша | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42145442229 |
| 2026-11-06 | **0f362856** / **build-300** | dexie-db.ts; защита случаев с несколькими сообщениями на один fileId и удалением одной ссылки | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42145518504 |
| 2026-11-06 | **792b5c57** (docs) | PROGRESS.md обновлён после build-298/300; не изменение кода | GitHub confirmed |
| 2026-11-06 | **c9179ead** / **build-301** | onion-engine, delivery-status-policy + tests: bounded UI event tracker, не посылать late sent после delivered | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42146398182 |
| 2026-11-06 | **dca1decc** / **build-302** | onion-engine: восстановление encrypted inbox по одному кадру; очередь outbox без массивов всех ciphertext | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42146576834 |
| 2026-11-06 | **31394887** / **build-303** | onion-engine: peer/due индексированные scans и сортировка только metadata, точный createdAt order | **SUCCESS** https://github.com/BauRP/project-revival-kit/actions/runs/42146708932 |

**Последние полные workflow:**
- **build-335 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42708814516 (conditional legacy profile retirement, foreign identity verification, complete APK checks)
- **build-334 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42594433277 (identity verified before retirement)
- **build-333 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42594068919 (malformed/foreign profile rejected)
- **build-332 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42593636860 (encrypted own profile)
- **build-331 FAILURE:** https://github.com/BauRP/project-revival-kit/actions/runs/42593430549 (unit test syntax error, fixed in build-332)
- **build-330 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42572631337
- **build-329 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42572283205
- **build-328 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42572120263
- **build-327 FAILURE** (TypeScript BlobRecord typing, corrected in 328): https://github.com/BauRP/project-revival-kit/actions/runs/42571853010
- **build-326 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42389925248 (restored deletion privacy)
- **build-325 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42389722554 (reaction outbox purge)
- **build-324 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42389490053 (late deleted-message reactions)
- **build-323 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42382095025 (legacy encrypted fragment upgrade)
- **build-322 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42381878762 (new encrypted partial fragments)
- **build-321 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42373311595
- build-320 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42373104507
- build-319 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42372849004
- **build-318 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42333901867 (key bootstrap, strict IndexedDB and full Android APK)
- **build-317 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42224831352
- build-316 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42224527533
- **build-315 FAILURE** (BufferSource TypeScript): https://github.com/BauRP/project-revival-kit/actions/runs/42224353684
- **build-314 FAILURE** (BufferSource TypeScript): https://github.com/BauRP/project-revival-kit/actions/runs/42224095218
- build-313 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42223710499
- **build-312 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42166428094 (shared media parent authorization + Android JVM tests)
- **build-311 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42165882854 (впервые JVM unit tests + universal APK)
- **build-310 SUCCESS:** https://github.com/BauRP/project-revival-kit/actions/runs/42152531633
- build-309 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42152309466
- **build-308 FAILURE** (неудачное ожидание микрозадач в тесте, исправлено в 309): https://github.com/BauRP/project-revival-kit/actions/runs/42152123844
- build-307 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42151979080
- build-306 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42151606280
- build-305 SUCCESS: https://github.com/BauRP/project-revival-kit/actions/runs/42151444824
- **build-304 FAILURE** (некорректная тестовая строка, исправлено в 305): https://github.com/BauRP/project-revival-kit/actions/runs/42151337558

**Предыдущие успешные workflow:**
- build-303: https://github.com/BauRP/project-revival-kit/actions/runs/42146708932
- build-302: https://github.com/BauRP/project-revival-kit/actions/runs/42146576834
- build-301: https://github.com/BauRP/project-revival-kit/actions/runs/42146398182
- build-300: https://github.com/BauRP/project-revival-kit/actions/runs/42145518504
- build-299: https://github.com/BauRP/project-revival-kit/actions/runs/42145442229
- build-298: https://github.com/BauRP/project-revival-kit/actions/runs/42145196304

**Ранее:**
- build-291: https://github.com/BauRP/project-revival-kit/actions/runs/42130212823
- build-292: https://github.com/BauRP/project-revival-kit/actions/runs/42130450738
- build-293: https://github.com/BauRP/project-revival-kit/actions/runs/42130721491
- build-294: https://github.com/BauRP/project-revival-kit/actions/runs/42130904069
- **build-295:** https://github.com/BauRP/project-revival-kit/actions/runs/42131197380

Для build-295 подтверждены GitHub Actions: **bun install --frozen-lockfile**, **bunx vitest run**, **bunx tsc --noEmit --pretty false**, **CAP_BUILD=1 bun run build**, stage scripts, cap sync, Gradle clean assembleDebug, universal APK select, min/target SDK badging, четыре ABI libtor.so, release upload. Отдельно НЕ запускались в подтверждённом baseline: Android эмулятор smoke, instrumentation, два телефона Tor, полный release/signing/minify verification, офлайн ASR inference. Эти пробелы нельзя заменять общим success.

---

## 8. Проверка, тестирование, команды, статусы

### 8.1 Локальная / CI последовательность
В корне репозитория (Bun 1.3.3, Node22, JDK21, Android SDK/NDK; без изменения lockfile):

~~~bash
git checkout chatgpt/trivo-security-compat-20261031
git status --short
git rev-parse HEAD
bun install --frozen-lockfile
bunx vitest run
bunx tsc --noEmit --pretty false
CAP_BUILD=1 bun run build
node scripts/stage-web.mjs
node scripts/fix-relative-assets.mjs
node scripts/verify-web-dir.mjs
npx cap sync android
cd android
./gradlew clean assembleDebug --no-daemon --stacktrace
~~~

Для исходного дерева не требуется Git CLI, если работать через подключённый GitHub connector: сравнить refs/commits, fetch_file по конкретным путям, create_tree с base_tree, create_commit, update_ref с **expected_sha**. Проверить HEAD после обновления, не force-push.

### 8.2 Что именно подтверждает build-295
| Проверка | Статус на 4e97ba75 | Точная сущность |
|---|---|---|
| Unit tests | **SUCCESS** | GitHub Actions step Run unit tests / bunx vitest run; тесты находятся в src/lib/__tests__ |
| TypeScript | **SUCCESS** | bunx tsc --noEmit --pretty false |
| Web compilation | **SUCCESS** | CAP_BUILD=1 bun run build |
| Staged WebView assets | **SUCCESS** | stage-web, fix-relative-assets, verify-web-dir, www/index.html |
| Android debug APK | **SUCCESS** | ./gradlew clean assembleDebug --no-daemon --stacktrace |
| Android manifest SDK audit | **SUCCESS** | aapt badging: min24, target36 |
| Tor native libraries | **SUCCESS** | arm64-v8a, armeabi-v7a, x86_64, x86 / libtor.so |
| GitHub APK release | **SUCCESS** | build-295 universal-debug APK; ссылка в начале |
| Release APK/R8 tested | **NOT CONFIRMED** | CI собирала debug, не final signed release |
| Emulator start, logcat ANR | **NOT RUN in baseline** | Нужен выделенный GitHub emulator job или локальный Android test runner |
| 2-device Tor send/receive | **NOT RUN by assistant** | Отдельное пользовательское/device-e2e испытание, не блокирует завершение сделанного кода |
| Android 17 full compatibility | **NOT CONFIRMED** | target36 — не Android17 |
| Offline PQ / STT | **NOT IMPLEMENTED** | Не выдавать green CI за реализацию отсутствующей функции |

**CI на документ:** push документа тоже может запустить workflow автоматически; это не означает изменения APK-функционала. Для чисто документационного коммита проценты остаются прежними. Если CI падает по независимым причинам, записать конкретный job/log, не подменять результат.

### 8.3 Ближайшие тестовые спецификации (не планы вместо работы)
- Local encryption migration: прошлые plaintext records, несколько перезапусков между «new ciphertext committed» и «old delete», потеря Keystore, fallback, backup roundtrip, index/search, no accidental rekey.
- Backup/privacy: восстановленный tombstone выигрывает у старого локального, incoming blocked; duplicate IDs invalid; large Blob import fail midway rolls back; старый outbox не реактивируется.
- Tor inbound: corrupt/truncated native frame, queue full (64MiB / 4096), process restart at any stage before ACK, duplicate no double notification, sender/recipient mismatch.
- Tor media: delete during download, consumed-media during streaming, mismatched file length/MIME/name, repeated index with different digest, missing chunks beyond 128 windows, stalled peer.
- Scheduled: two simultaneous senders, background→foreground, time correction backwards/вперёд, Keystore unavailable then recovery, user cancelled while encrypting; no duplicate on restart.
- Android: cold-start with Tor down, permissions denied, IME, 3-button/gesture, orientation, ABI, API24/26/29/34/36 and when available Android17.

---

## 9. Очередь задач с зависимостями и независимыми альтернативами

Приоритеты изменять по реальным подтверждённым регрессиям. «Пользователь должен установить APK на свой телефон» не включать в список незаконченного программного кода.

| Порядок | Приоритет | Работа и точные файлы | Критерий завершения / проверка |
|---|---|---|---|
| **1** | **P0** | **Проверяемое шифрование локальных данных**: src/lib/dexie-db.ts, storage.ts, safe-storage.ts, crypto.ts, android/.../SecureVaultPlugin.java, p2p.ts, backup.ts, identity-transfer.ts | Полная модель данных/индексов; ciphertext at rest, crash-safe migration, отсутствие тайного plaintext fallback; тесты + APK. Не терять old data/identity |
| **2** | **P0** | **Нативная фоновая доставка Tor**, не зависящая от активного WebView: TorOnionService.java, TorTransportPlugin.java, NativeInboundQueue.java, onion-engine.ts, outbox.ts, AndroidManifest.xml | Строгая шифрованная native queue и lifecycle; без нарушения FGS policy/Keystore; integration tests + APK |
| **3** | **P0** | **Настоящий post-quantum key agreement**: crypto.ts, envelope.ts, onion-id.ts, crypto-async.ts, workers/crypto.worker.ts, SecurityDashboard.tsx | Аудит и реальная ML-KEM/hybrid implementation, version negotiation, downgrade rejection, two-peer tests. До этого 0% |
| **4** | **P1** | **Tor ACK/inbox + performance**: onion-engine.ts, dexie-db.ts, inbound-*.ts, NativeInboundQueue.java | Fuzz/integration tests; отсутствие duplicate ACK/аннулирования сообщений и сохранение при crash |
| **5** | **P1** | **Верификация backup/restore и большие файлы**: backup.ts, backup-crypto.ts, backup-validation.ts, dexie-db.ts, backup-merge-policy.ts | Failure injection на миграции/large backups; ограничение peak RAM, нет resurrection, CI green |
| **6** | **P1** | **Офлайн STT с реально bundled моделью**: TranscriptionPlate.tsx, stt-cache.ts, transcribe.functions.ts, native runtime (требует выбора) | Полное отсутствие сети и платных API, реальная аудио→текст работа, недостающие языки/size/performance измерены |
| **7** | **P1** | **Отложенная отправка и уведомления без открытого чата**: outbox.ts, scheduled-policy.ts, notifications.ts, TorOnionService.java | Планирование после закрытия UI, без plaintext локально и повтора; tests |
| **8** | **P1** | **Android 7–17 matrix / emulator automation**: MainActivity.java, Manifest, android/app/build.gradle, .github/workflows/android_build.yml | CI emulator smoke/logcat и runtime checks; без реального device не утверждать все платформы |
| **9** | **P1** | **History protection peer integration**: history-protection.ts, history-protection-policy.ts, sync/message-lifecycle.ts, ChatRoom.tsx | Две стороны, offline toggle, текст уведомления, оба delete buttons active, local delete allowed |
| **10** | **P2** | **Profile/reactions sync**: profile-wire.ts, profile.ts, reactions.ts, onion-engine.ts | Version conflicts/duplicates/offline replay tests |
| **11** | **P2** | **Экспериментальная маскировка/трафик**: stealth.ts, onion-engine.ts, SettingsPage.tsx | Не симулировать безопасность, контролировать батарею/данные |
| **12** | **ПАУЗА** | **Жалобы №13**: ReportMenu.tsx, report.ts | **Не менять до нового разрешения пользователя** |

Если приоритет 1 требует архитектуры/библиотеки, которая недоступна, **не застревать**: выполнить следующий независимый пункт 4, 5, 8 или unit тесты, не подменяя серьёзную криптографическую работу заглушкой. Для каждого пакета: код → тест → APK → запись в PROGRESS.

### Возможные тонкие дефекты для точечного следующего аудита (НЕ объявлены подтверждёнными)
- dexie-db.ts: часть blobToBase64 создаёт ArrayBuffer всего Blob; большой backup может превышать доступную память несмотря на последовательность файлов — проверить реальными пределами и тестом.
- onion-engine.ts: одна подписанная большая media-передача вызывает многократную проверку разрешения через IndexedDB; насколько это достаточно под высокой нагрузкой, ещё не измерялось.
- NativeInboundQueue и JS inbox_raw: две последовательные durable queues требуют полной модели ACK, при потере питания нельзя ACK раньше коммита.
- outbox.ts: локальный таймер всё ещё зависит от живого JS; visibility-change решает только возврат на экран.
- Backup: если в persisted lifecycle записи имеют конфликтные timestamps, текущее правило irreversible override — безопасное для privacy, но нужна формальная политика merge для остального состояния.

---

### 2026-11-06 — постоянная инструкция AGENTS2.md (документационный этап)

- Запрос: создать профессиональные постоянные инструкции разработчика без изменения управляемого Lovable корневого AGENTS.md. На этой ветке проверено: AGENTS.md существует и содержит блок LOVABLE:BEGIN/END; ни AGENTS2.md, ни вложенных AGENTS.md до работы не существовало.
- Создан **корневой AGENTS2.md**: быстрый алгоритм запуска из PROGRESS.md, точная карта подсистем и путей, правила Tor/Keystore/Dexie/tombstones, разработка в крупном пакете, GitHub-safe push, тесты Bun/Vitest/TypeScript/Capacitor/Gradle, допуск ошибок и лицензий, разделение runtime/CI, **11 утверждённых пользователем правил дословно**.
- Документационный коммит: в этом коммите содержатся только AGENTS2.md и обновление PROGRESS.md; точный SHA см. историю двух файлов GitHub после push (самоцитирование SHA внутри этого коммита невозможно).
- **Исходный код и архитектура не изменены; прирост направлений 0,0 п.п.; общая готовность ПО 37,0%.** Последняя кодовая база **313948878d470124e0d3bd39db6d3126aa1832ce**, GitHub Actions **build-303 success**: https://github.com/BauRP/project-revival-kit/actions/runs/42146708932. APK этого документационного коммита отдельно не собиралась: конфигурация и код не менялись.
- Следующий запуск: читать **PROGRESS.md → AGENTS.md → AGENTS2.md** и новый diff, затем выполнять P0 шифрование локальной истории или независимые P1 Tor/Dexie fault-injection интеграционные тесты. Не повторять уже успешно прошедшие билды без изменений кода.

## 10. Регламент постоянного обновления PROGRESS.md

### ПРАВИЛО ПРИОРИТЕТА 0 — ОБЯЗАТЕЛЬНО ПРИ КАЖДОМ ЗАПРОСЕ
**Пользователь прямо утвердил 2026-11-06:** ChatGPT обязан обновлять один постоянный `PROGRESS.md` в согласованной ветке GitHub **при КАЖДОМ запросе, касающемся этого проекта**, даже если пользователь забыл упомянуть файл или задача ограничилась анализом, проверкой, обсуждением или планом. Это правило важнее прежней формулировки «после каждого крупного пакета». В новом чате считать его обязательным без повторного разрешения.

- Перед работой сверить журнал и HEAD; после работы записать суть запроса, фактическое решение, статус, проверки и дальнейшие действия.
- **Если код не менялся:** обновить журнал записью «код не изменён», указать причину и не увеличивать готовность. Не создавать ложных результатов тестов или коммитов, которые не проводились.
- **Если был крупный пакет:** обновить карту затронутых модулей, ошибки, CI и метрики вместе с итоговым коммитом.
- **Если GitHub недоступен/нет прав:** честно сказать, что выполнить обязательное обновление невозможно; не утверждать обратное.
- Не затрагивать `main`; не перезаписывать чужую историю или одновременно изменённый журнал. Не сохранять секреты.
- Отдельные бытовые вопросы, не относящиеся к Trivo Chat Elite, не меняют проектный журнал.

**Каждый запрос по проекту включает ОБНОВЛЕНИЕ ЭТОГО ЖЕ ФАЙЛА непосредственно в GitHub:**
1. Прочитать раздел 0 и последнюю запись в разделе 7. Сверить GitHub branch HEAD; установить diff с записанной кодовой базой. Если поменялся не только PROGRESS.md — изучить изменённые файлы, тесты и связь с текущим пакетом.
2. Добавить короткую датированную строку: точные модули, реально закрытые условия, тесты/команды, git SHA и CI run URL; failed CI записать как failed до исправления, не скрывать.
3. Обновить критические проблемы в разделе 6: fixed/mitigated/open, доказательства и сохраняющиеся границы.
4. Обновить таблицу 20 направлений и общий % **без искусственного роста**. Отмечать п.п. и конкретные CI SHA, не привязывать процент к числу коммитов.
5. В разделе 9 убрать/переупорядочить только реально завершённые инженерные задачи; пользовательские device checks вынести отдельно и не снижать готовность ПО.
6. Обновить «с чего продолжить» и список точных стартовых файлов под новую задачу.
7. Сохранять изменения в **одном и том же** PROGRESS.md в рабочей ветке; при конфликте ref — перечитать новый HEAD и пересогласовать, никогда не force-push или overwrite чужой новый коммит.
8. Не записывать ни plaintext identity, ни ключи, токены, номера пользователей/аккаунтов, пароли, contents личной переписки.
9. Не копировать весь код/чат в журнал: сохранять схемы, суть, пути, утверждённые решения, тесты, трудные инварианты и полезные ссылки.
10. На каждом новом запуске: кратко сообщить пользователю уже сделанное и обновлённую готовность, основное время уделять реальной разработке.

---

> **Обязательная инструкция:** перед началом работы открыть корневой AGENTS2.md (не изменяя Lovable-managed AGENTS.md), вместе с PROGRESS.md. Все 11 правил пользователя дословно закреплены в AGENTS2.md. Правило обновлять PROGRESS.md после КАЖДОГО запроса по проекту остаётся в силе.

## 11. С чего продолжить в следующем чате

**Контрольная точка кода: 7633c943e54a85c54bd2079af8859e79303cd49d, build-352 SUCCESS, общая готовность ПО 39,8% (+0,2 п.п. от build-351).** Создающий запись документационный коммит не изменяет программный код.

**Точка продолжения после build-335:** исправлена атомарная защита удаления legacy-профиля и проверка владельца existing ciphertext; не повторять этот пакет. Дальше P0 — весь путь Dexie messages/lifecycle/contacts: map direct read/write, конверты AES-GCM с публичными индексами, безопасная idempotent migration + backup restore, обновлённый ciphertext inventory; начинать с `src/lib/dexie-db.ts`, `src/lib/p2p.ts`, `src/lib/onion-engine.ts`, `src/lib/protected-record-inventory.ts`, `src/lib/local-record-crypto.ts`. Перед включением шифрования нужны строгие интеграционные тесты совместимости. Отдельно P1 — многовкладочная гонка двух simultaneous encrypted saves и инструментальная проверка Android Keystore kill/restart.

**Следующая точка после build-336:** выполнена защита от stale/concurrent профиля, её не повторять. Продолжать P0: AES-GCM at-rest сообщения/lifecycle/contacts/готовых медиа с Dexie read/write адаптерами, публичными индексами, crash-safe миграцией, защитой потерянного master key и backup compatibility. Для начала составить карту прямых чтений/записей `src/lib/dexie-db.ts`, `src/lib/p2p.ts`, `src/lib/onion-engine.ts` (много bypass-операций, частичное включение шифрования небезопасно). При невозможности закрыть весь путь одной итерацией — P1: Dexie native/integration fault injection. Сохранять данные при сбое и прежние working backups.

**Следующая точка после build-337:** реализовано Android AES-GCM для legacy `trivo-chat/contacts` через `protected-chat-meta.ts`; не повторять. Критический P0 по-прежнему `trivo-p2p`: `dxdb.messages`, `dxdb.contacts`, `dxdb.lifecycle`, `dxdb.blobs` + native/legacy plaintext copies. При следующем подключении начать с `src/lib/dexie-db.ts` схемы/backup, `src/lib/p2p.ts` и `src/lib/onion-engine.ts` всех direct readers/writers. Разработать совместимую атомарную миграцию и тесты Dexie с независимым backup V3. Не запускать частичное шифрование Dexie, которое нельзя прочитать старыми прямыми читателями. Отдельный P1: integration тесты `protected-chat-meta` с реальной IndexedDB, interrupted upgrade и сценарий нескольких окон; защита зависит от надежности IDB transaction.

**Установочная точка после build-340:** подтверждено `adb install`/ `adb install -r` на GitHub Android 15 x86_64. Для обновления APK со старой build-337 или более ранней подписью нужен исходный private signer, которого в проекте нет; не советовать потерять Tor identity/чаты удалением без backup. Для долгоживущих обновлений перевести тестовую signing identity из evictable Actions cache в GitHub Secrets по согласованию, не коммитить ключ. Остальная разработка P0: шифрование `dxdb.messages`, `dxdb.contacts`, `dxdb.lifecycle`, `dxdb.blobs`, crash-safe migration и backup compatibility. Не считать установки на всех Android API проверенными по одному Android 15.

**Точка продолжения после build-344:** все 396 Git файлов просканированы по всем 42 955 текстовым строкам автоматическим анализом; артефакт `trivo-repository-audit-344` содержит пофайловый JSON и полный ESLint. Точечные подтверждённые дефекты миграции v1 contacts, bounded audio waveform, blocked IDB connection исправлены и проверены CI. Не выдавать lint-замечания форматирования за функциональные ошибки; не обещать полного ручного semantic review каждой строки. Основной P0 остаётся **полное шифрование Dexie messages/contacts/lifecycle/media** c backup migration; отдельно рассмотреть конфиденциальность внешних Google Fonts без самостоятельной смены дизайна. Пауза #13 сохраняется.

**Точка продолжения после build-346:** общее native biometric lock state, запрет unsafe enable, ID-based friend subscriptions и username updates в ChatRoom уже внедрены, не повторять. CI build-346 green на SHA `4135ab39` (Android 15 x86_64 reinstall без удаления тестового файла). Дальше критический P0 — полное encrypted at-rest хранение `dxdb.messages/lifecycle/contacts/blobs` через существующий AES-GCM/Keystore с versioned миграцией, инвентарём ciphertext, недеструктивной backup/identity compatibility. Независимый P1: integration test cold start с реальной биометрией и сценарий отключения/смены датчика (не выдавать эмуляторную установку за этот тест). Reports #13 остаются приостановлены.

**Следующая точка после build-348:** CAS metadata и read-modify-write для incoming/outgoing/forward/contact profile уже сделаны; не повторять. Следующий главный P0 — реальная full Dexie at-rest encryption `messages/lifecycle/contacts/blobs` с complete readers/writers, stored-key inventory, crash-safe idempotent migration и portable backups. Отдельный P1: реальный IndexedDB concurrency/fault-injection для conflict retry and clear-on-read races, latest-message replay dedupe window. #13 жалобы/репорты НЕ менять. Прирост показывать зелёным в пользовательском отчёте, включая доли процента.

**Точка продолжения после build-351:** friend_request/status CAS и replay/accepted-safe flow завершены, не повторять. Следующий главный P0: полноценное Dexie AES-GCM/Android Keystore шифрование messages/lifecycle/contacts/ready blobs с безопасной пошаговой миграцией, защитой ключей, совместимостью backup и всех прямых transaction читателей/писателей. Независимый P1: реальная fault-injection в IndexedDB и Tor ACK replay power loss, не ограничиваясь mocked CAS. #13 жалобы/репорты строго на паузе. Прирост за цикл выделять зелёным в отчёте, включая десятые доли процентного пункта.

**Точка продолжения после build-352:** Android Dexie contacts displayName protected, lost-key detection и V3 portable backup adaptation сделаны; не повторять. Следующий критический P0: все читатели/писатели `dxdb.messages` и `dxdb.lifecycle` (indexed public metadata, ciphertext private payload), затем `dxdb.blobs` с bounded streaming encrypt/decrypt; crash-safe историческая миграция, полная replay/backup compatibility, Android Keystore key reuse. Не объявлять частичное encrypted name полной защитой локальной переписки. Независимый P1: реальная IndexedDB migration failure-injection + Android Keystore process-restart тесты. Жалобы #13 строго на паузе, никаких сокращений направлений без согласия пользователя.

**Главный следующий блок P0: закрыть реальный пробел безопасности локальной истории**. Работать от требований: Android Keystore, offline, без лишнего ручного пароля, без тихой смены identity, без потери существующих сообщений, с безопасным crash-safe восстановлением. Не обещать результат, пока нет реализации и тестов. Первые файлы:
- src/lib/dexie-db.ts — таблицы и миграция истории, indexes; exportDexieDump/importDexieDump.
- src/lib/storage.ts, src/lib/safe-storage.ts, src/lib/p2p.ts — путь записи старых и новых сообщений, фолбэки, удаление.
- src/lib/crypto.ts, android/app/src/main/java/com/baurp/trivochat/SecureVaultPlugin.java, src/lib/identity-transfer.ts — KeyStore, fingerprint, перенос личных ключей.
- src/lib/backup.ts, src/lib/backup-crypto.ts, src/lib/backup-merge-policy.ts, src/lib/backup-validation.ts — обязательное безоткатное восстановление.
- src/lib/__tests__/identity-validation.test.ts, backup-merge-policy.test.ts, backup-validation.test.ts, hidden-message-migration.test.ts — начать с точных тестов.

**Независимая следующая P1 задача для быстрого продолжения:** `src/lib/onion-engine.ts`, `src/lib/inbound-durability.ts`, `src/lib/dexie-db.ts`, `android/app/src/main/java/com/baurp/trivochat/tor/NativeInboundQueue.java`. Добавить реальные integration/fault-injection тесты Tor ACK и crash/replay; уже выполненные в builds 298/301 UI-status и builds 302/303 memory-queue fixes не повторять.

**Ближайшая независимая P1 задача:** тесты реальных Dexie commit + signed ACK + NativeInboundQueue replay/failure injection: `src/lib/onion-engine.ts`, `src/lib/dexie-db.ts`, `android/app/src/main/java/com/baurp/trivochat/tor/NativeInboundQueue.java`, `src/lib/inbound-durability.ts`. В builds 305–310 уже закрыты concurrent same-frame/same-file races, collision и crypto transient retention; не повторять их. Если нативная среда недоступна, перейти к реально исполняемым unit test + безопасной архитектуре P0 at-rest encryption.

**Следующая точка P1 (независимо от P0):** `NativeInboundQueue.java`, `NativeInboundQueueFiles.java`, `TorTransportPlugin.java`, `onion-engine.ts`: Android runtime fault-injection AtomicFile rollback/ACK и передача после power-loss. Java `testDebugUnitTest` уже настроен в CI, не дублировать. История `build-311` содержит границу доказательств. 

**Следующая независимая P1 задача:** stress/fault injection Android native queue и Dexie media lifecycle: `android/app/src/main/java/com/baurp/trivochat/tor/NativeInboundQueue.java`, `src/lib/onion-engine.ts`, `src/lib/message-deletion-policy.ts`, `src/lib/dexie-db.ts`. Builds 311/312 уже исправили AtomicFile recovery и shared signed media parent lookup. Не повторять завершённое.

**Точная следующая P0 интеграция (после build-317):** начать с `src/lib/local-record-crypto.ts`, `src/lib/local-record-key.ts`, `android/app/src/main/java/com/baurp/trivochat/SecureVaultPlugin.java` (готовые tested primitives), `src/lib/dexie-db.ts` (schema/index/export/import), `src/lib/p2p.ts`, `src/lib/onion-engine.ts` (direct readers/writers), `src/lib/backup.ts`/`backup-validation.ts` (portable decrypted format). Запись wrapper должна быть durable до первого ciphertext, при потерянном Keystore wrapper запрещено генерировать другой key. Не шифровать те поля, которые индекс Dexie требует открытыми, не оставлять plaintext после подтверждённой миграции. Реализовать migration replay после kill/restart и интеграционные Dexie tests. **До реализации это не завершённая encryption feature.**

**Следующая точка P0 после build-318:** `src/lib/storage.ts` (strict abort/commit and insert-only settings), `src/lib/local-record-key-store.ts` (one-time Keystore-wrapped key bootstrap), `src/lib/local-record-key.ts`, `src/lib/local-record-crypto.ts`, `src/lib/dexie-db.ts`, `src/lib/p2p.ts`, `src/lib/onion-engine.ts`, `src/lib/backup.ts`. Design versioned encrypted row storage for messages/lifecycle with public index metadata only; build durable crash recovery, verify ciphertext before deleting legacy plaintext, and preserve portable backups. Do not activate if any direct Dexie writer/reader bypass remains. Only after real unit+integration migration tests and a green APK count encryption as working.

**Next P1 if P0 storage encryption blocks:** review `src/lib/dexie-db.ts` `enforceMediaCacheLimit` / `putReceivedBlob` / `discardUnreferencedUpload`, `src/lib/media-cache-policy.ts`, `src/lib/media-store.ts`. Builds 319–321 already fix live-reference deletion races, user-origin retention and fileId overwrite; don't repeat fixes. Add true fake-indexeddb/native runtime fault injection and preserve backup merge compatibility. The primary P0 migration remains the first priority.

**Next P0 full-history encryption:** start with `src/lib/dexie-db.ts` schema and `src/lib/p2p.ts`/`src/lib/onion-engine.ts` all direct message/lifecycle readers/writers, `src/lib/backup.ts`, then reuse `local-record-crypto.ts`, `local-record-key-store.ts`. `partial-chunk-vault.ts` and `legacy-chunk-migration.ts` are COMPLETE narrow protections as of build-323; do not confuse them with encrypted history. Native runtime tests for keys and resume remain separate evidence.

**Next independent P1 if P0 encrypted migration still blocked:** `src/lib/reactions.ts`, `src/lib/reaction-deletion-policy.ts`, `src/lib/onion-engine.ts`, `src/lib/dexie-db.ts` backup import. Builds 324–326 close deleted message reaction resurrection and event queue replay. Add real Dexie transaction fault-injection, consistency across backup restore/peer ACK. Do not repeat completed fixes. Full at-rest encryption for messages remains P0.

**Новая точка P0 после build-330:** `src/lib/dexie-db.ts`, `src/lib/local-record-crypto.ts`, `src/lib/local-record-key-store.ts`, `src/lib/p2p.ts`, `src/lib/onion-engine.ts`: завершить создание фактически зашифрованных messages/lifecycle/contact records с учётом всех прямых вызовов Dexie и crash-safe migration. Portable V3 export теперь берёт консистентный snapshot и использует `backup-snapshot-policy.ts`, `backup-media-codec.ts`, `backup-export-privacy.ts`; сохранить их при переходе на шифрованные таблицы. Следующий независимый P1: fake-indexeddb/native integration concurrent restore/export/delete. 

**Следующая точка P0 после build-334:** `src/lib/protected-record-inventory.ts` (single Keystore key + защищённые storage detection), `src/lib/protected-local-profile.ts` (tested migration example), `src/lib/local-record-crypto.ts`, `src/lib/dexie-db.ts`, `src/lib/p2p.ts`, `src/lib/onion-engine.ts`. Перевести messages/lifecycle/contacts на authenticated encrypted records, сохранить нужные публичные индексы, полный crash-safe recovery/backup portability и не пропустить ни одного прямого чтения/записи. В инвентаре ciphertext перед новым защищённым table добавить его обнаружение, иначе потерянный wrapper может породить новый ключ. Нельзя считать полное Dexie шифрование выполненным до этого. 

**Пошаговый инженерный план:**
1. Построить data flow: где именно лежит plaintext, кому нужен поиск/index, какие поля нужны UI. Составить versioned encrypted record format, key hierarchy, threat model; не хранить новый master key plaintext/вместе с ciphertext.
2. Добавить чистые тестируемые функции шифрования/дешифрования и новые storage adapters. Fail closed на Android при недоступном Keystore. Не менять DB schema на несовместимую без migration.
3. Миграция legacy: сначала записать и проверить authenticated ciphertext, только затем удалить plaintext; сделать её idempotent, поддержать interruption/restart. Проверить reuse same identity и backup/export/import.
4. Сначала unit + strict TypeScript + web build; затем один debug APK полный CI. Если ошибка — чинить и запускать снова. Успешную сборку/тесты записать в раздел 7 с SHA.
5. Только после завершения обновить % направления 2 и общий %; если за один запуск готов лишь безопасный кусок, не объявлять все 100%.
6. Параллельно, если архитектурный ключевой блок временно недоступен, перейти к самостоятельным Tor NativeInboundQueue ACK, profile/reactions tests или Android emulator CI, не к фиктивному PQXDH.
7. Обновить **этот** PROGRESS.md и push только согласованной ветки.

**Команды:** из корня проекта: bun install --frozen-lockfile; bunx vitest run; bunx tsc --noEmit --pretty false; CAP_BUILD=1 bun run build; node scripts/stage-web.mjs; node scripts/fix-relative-assets.mjs; node scripts/verify-web-dir.mjs; npx cap sync android; в android: ./gradlew clean assembleDebug --no-daemon --stacktrace. В GitHub можно дождаться workflow по push и использовать его как автоматическое подтверждение. Нельзя писать «Android 17 проверен», «PQ готов», «STT работает» без отдельной фактической проверки.

**Ожидаемый результат следующего крупного этапа:** реально защищённые на диске записи без потери истории и смены личности; доказательства из тестов и успешной Android APK; обновлённые 20 процентов, новый SHA и ссылка на CI. До выполнения этих условий P0 остаётся OPEN.

**Отдельные проверки на устройствах пользователя (НЕ считать незавершённой работой программиста):** поставить проверенную APK, проверить два телефона через Tor, восстановление переписки/резервной копии, разрешения/навигацию на реальном Android, файл во время удаления, уведомления при сворачивании. Результат сообщит пользователь; это не должно искусственно снижать процент выполненной программной части.
