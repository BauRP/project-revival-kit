# PROGRESS.md — Trivo Chat Elite: рабочий технический журнал

> **Порядок использования:** В новом чате сначала открыть этот файл, проверить HEAD рабочей ветки, сравнить его с указанной ниже проверенной базой и изучить только изменённые или необходимые для текущей задачи файлы. **КРИТИЧЕСКОЕ постоянное требование пользователя:** при КАЖДОМ запросе по разработке/проверке/анализу Trivo Chat Elite, даже если пользователь не упомянул журнал и даже если не было изменений кода, обязательно актуализировать ЭТОТ ЖЕ PROGRESS.md непосредственно в GitHub. Это не ограничивается крупными пакетами. Если по запросу не было подтверждённых кодовых изменений — записать результат и статус без выдуманных процентов. При отсутствии доступа к GitHub честно сообщить, что обновление не выполнено; никогда не выдавать несохранённое за сохранённое. Достоверность: «код просмотрен» ≠ «функция проверена на устройстве».

## 0. БЫСТРЫЙ СТАРТ — прочитать за 2 минуты

| Поле | Зафиксированное состояние на 2026-11-06 |
|---|---|
| Приложение | **Trivo Chat Elite**, приватный Android/Web мессенджер с Tor v3 onion, локальными данными и E2EE |
| GitHub | https://github.com/BauRP/project-revival-kit |
| Рабочая ветка | **chatgpt/trivo-security-compat-20261031**; **main не менять** |
| Последний подтверждённый КОДОВЫЙ HEAD, на базе которого составлен журнал | **0f362856bc8da0d1767605afb868e859ed79ce94** |
| Последний полностью успешный workflow | **build-300**, https://github.com/BauRP/project-revival-kit/actions/runs/42145518504 (build-298/299 также success) |
| Проверенная APK | https://github.com/BauRP/project-revival-kit/releases/download/build-300/app-universal-debug.apk — универсальная debug APK, CI success |
| Оценка готовности ПО | **36,9%** (+0,2 п.п. с прошлого проверенного этапа), историческая приблизительная оценка; не выводится автоматически из кода |
| Недавняя работа | build-298–300: атомарные монотонные статусы Tor send/ACK/read, сохранение статуса при локальной записи; индексированные запросы истории, память при чистке Blob-кэша, проверка нескольких ссылок на одно вложение; CI Bun/Gradle caching |
| **P0, наибольшие пробелы** | Реального PQXDH/ML-KEM **нет**; локальная Dexie-база переписки не шифруется полностью; нет независимого от WebView нативного фонового отправителя; полноценной встроенной офлайн-STT-модели нет |
| **Ближайшая инженерная задача** | P0: шифрование локальной истории и crash-safe миграция без потери данных. Независимый P1: гарантировать порядок UI-событий delivered/sent при конкурентном ACK и расширить интеграционные Dexie/Tor tests |
| Открыть первыми | src/lib/dexie-db.ts, src/lib/storage.ts, src/lib/safe-storage.ts, src/lib/crypto.ts, android/app/src/main/java/com/baurp/trivochat/SecureVaultPlugin.java, src/lib/p2p.ts, src/lib/backup.ts, src/lib/backup-merge-policy.ts |
| Контрольные команды | **bun install --frozen-lockfile** → **bunx vitest run** → **bunx tsc --noEmit --pretty false** → **CAP_BUILD=1 bun run build** → stage-web/fix-relative-assets/verify-web-dir → **npx cap sync android** → в android: **./gradlew clean assembleDebug --no-daemon --stacktrace** |
| Ограничения | Нет Firebase/Supabase, внешней базы, рекламы, обязательной регистрации на сервере или облачного AI; secrets не записывать. Жалобы/репорты (направление 13) **на паузе**. Никаких принудительных push/rebase/squash опубликованной истории |

**Правило коммитов для журнала:** SHA самого коммита, содержащего текст PROGRESS.md, невозможно заранее вписать в его же содержимое. Поэтому поле выше обозначает последнюю проверенную **кодовую базу** до создания журнала. SHA коммита журнала смотрите через историю PROGRESS.md и обновляйте поле при следующем пакете разработки. Дату и цифры ниже не менять задним числом без оснований.

### Что делать при возобновлении (быстро)
1. Открыть https://github.com/BauRP/project-revival-kit/blob/chatgpt/trivo-security-compat-20261031/PROGRESS.md.
2. Проверить git ref рабочей ветки; сравнить с последней зафиксированной **кодовой** базой 0f362856…; отдельно учесть документационные коммиты и новые изменения третьих сторон.
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

**Зафиксированная после build-300 общая оценка: 36,9%** (предыдущая 36,7%, +0,2 п.п. за успешно проверенные изменения). Это прежняя согласованная **оценка программной готовности**, не объективное вычисление количества функций. Проценты не суммировать/не усреднять как общий показатель: направления различаются по весу, сложности и рискам. Если методика весов станет фиксированной, описать её явно. **Пауза направления 13 не даёт права объявить его выполненным.**

| № | Направление | Готово | Последний прирост | Что есть / проверено | Остаток и ограничения |
|---|---|---:|---:|---|---|
| 1 | Настоящая постквантовая криптография | **0%** | 0 | Отсутствие PQ честно отображается; tests/pqxdh-safety.test.ts | Реальный ML-KEM/гибрид с безопасным handshake, версиями и тестами, не заглушка |
| 2 | Шифрование локальной БД/ключей | **19,9%** | 0 | Android Keystore для identity, scheduled text; identity recovery; CI | Dexie messages/lifecycle/contact/поиск остаются plaintext на диске; миграция без потери данных |
| 3 | Резервные копии и восстановление | **62,7%** | +0,8 | V2 AES-GCM, portable identity, validation, atomic *.pending rename, удаление tombstones, последовательный импорт Blob; build-291/294 | Большие архивы/пределы памяти, независимые фоны, детальные recovery tests, гарантия crash-safe переносимости |
| 4 | Отложенная отправка | **43,2%** | +0,7 | trivo-outbox, Keystore, миграция, dedupe, clock correction, visibility wake; build-295 | Доставка при завершённом WebView/force-stop, строгие жизненные циклы, device-level проверка |
| 5 | Фоновый Tor | **51,6%** | 0 | Нативный FGS, retry, статус, inbound queue, bootstrap; build-295 | Full background outgoing + incoming обработки без активного JS; Android FGS ограничения |
| 6 | Защита сообщений/edit/delete | **62,2%** | **+0,3** | build-298: статус не откатывается с delivered/read в sent при конкурентном ACK; проверено Vitest, TypeScript, Android debug APK | UI-callback ordering и интеграционные гонки, затем e2e Tor |
| 7 | Офлайн STT | **5,0%** | 0 | UI и обработчики-заглушки, stt-cache без plaintext | Реальная модель и inference в APK offline, многоязычность и метрики |
| 8 | Уведомления | **46,2%** | 0 | local notifications, mute/block/silent, приватные preview, fail-closed | Фоновая нативная обработка, каналы/режимы Android, надёжное отображение |
| 9 | Безопасная проверка файлов | **26,8%** | +0,5 | MIME/signatures/EXIF/active content, signed manifest, валидация полученного Blob | Не антивирус; расширенные форматы/unsafe вложения, DoS scanning, sandbox |
| 10 | Синхронизация профилей | **26,8%** | 0 | profile-wire/profile-policy, signed peer updates и Dexie | конфликт версий, offline reconcile, полноценные тесты синхронизации |
| 11 | Реакции/синхронизация | **36,1%** | 0 | реакции в lifecycle, timestamps, retry; tests | восстановление после потери связи, гонки, multi-client случаи |
| 12 | Экономия трафика/медиа | **75,5%** | **+0,5** | build-299/300: индексированный просмотр истории, cursor очистки Blob-кэша, узкий отбор вложений и сохранение живых shared-ссылок | Streaming assembly больших файлов, cancel, другие O(n) |
| 13 | Жалобы/репорты **ПАУЗА** | **0%** | 0 | Кодовая UI-заготовка может существовать | Не менять без разрешения пользователя |
| 14 | Одноразовые вложения | **40,2%** | +0,6 | lifecycle + consumed tombstone, backup merge, atomic chunk auth; build-291/293 | тесты гонок и полная проверка на телефонах, split/backup сценарии |
| 15 | Подлинный Tor статус | **27,0%** | 0 | strict isTorServiceReady; проверка .onion; status chip; build-283 | серверная достижимость, показ ошибок/повторных reconnect |
| 16 | Маскировка трафика | **8,0%** | 0 | экспериментальный sealed cover; off default | реальная доказуемая защита от анализа трафика, аккумулятор/сеть |
| 17 | Android permissions | **66,5%** | 0 | manifest, runtime on-demand, native services; CI SDK audit | Android 13+/14+/16+/17 permission and FGS variations |
| 18 | Автоматизированные испытания | **68,1%** | **+0,4** | build-298/299/300 success; новые Vitest delivery-status-policy и conversation-index-policy, GitHub CI кэши Bun/Gradle | Интеграционные Dexie/Tor/native, эмулятор/logcat |
| 19 | Android 7–17 и экраны | **18,8%** | 0 | min24/target36, WebView inset handling, ABI CI | API/gestures/IME/fold/rotation/runtime/Android17 |
| 20 | Защита истории переписки | **57,0%** | 0 | per-chat toggle, sync, denied remote edit/delete, notice, tests | конфликт состояний offline, UI одинаковое поведение всех кнопок, сквозные peer tests |

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
| src/lib/delivery-status-policy.ts | advanceDeliveryStatus: монотонный порядок pending/sent/delivered/read | onion-engine.ts, p2p.ts; tests/delivery-status-policy; build-298 |
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
- **STATUS-ACK-01 / FIXED-CI build-298:** sendOutboxOnce мог откатывать статус pending → sent, пока параллельный DELIVERED_ACK уже поставил delivered. Теперь атомарный Dexie modify с advanceDeliveryStatus; локальное сохранение также не понижает статус. **Открыто:** порядок UI-callback уведомлений при редкой гонке (отдельно от сохраняемого DB статуса).
- **PERF-CHAT-01 / FIXED-CI build-299:** getMessagesForChat не читает все чужие чаты; выборка по двум индексам from/to в read transaction, merge с тестами.
- **PERF-BLOB-01 / FIXED-CI build-299:** Blob cache eviction теперь идёт курсором oldest-first и не собирает массив всех Blob; не удаляет вложения, на которые ссылаются сообщения.
- **MEDIA-REF-01 / FIXED-CI build-300:** вложение может быть связано с несколькими сообщениями; удалённый parent не должен мешать приёмке файла по другому живому parent.
- **CI-ACCEL-01 / FIXED-CI build-298:** setup-java cache:gradle и GitHub Actions Bun-download cache (по bun.lock). Предыдущие workflow не пересобирать без причин.
- **Сборки:** build-298, build-299, build-300 = SUCCESS (unit, TypeScript, web, Android debug, SDK/ABI, release upload); это не тест на двух физических устройствах.


## 7. Журнал фактической разработки и GitHub CI

**Все указанные SHA — коммиты в рабочей ветке.** Ниже приоритет недавним пакетам, полезным для следующего запуска, без переписывания переписки.

| Дата (по времени разработки) | Коммит / сборка | Пакет, связанные файлы | Подтверждение |
|---|---|---|---|
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

**Последние полные workflows (все SUCCESS):**
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

## 11. С чего продолжить в следующем чате

**Контрольная точка кода: 0f362856bc8da0d1767605afb868e859ed79ce94, build-300 SUCCESS, общая готовность ПО 36,9% (+0,2 п.п.).** Коммит, создающий сам PROGRESS.md, лежит после этой точки и не меняет программный функционал. При новом чате сначала получить HEAD, проверить diff: может быть не только документ, но и новая разработка Lovable/другого ChatGPT.

**Главный следующий блок P0: закрыть реальный пробел безопасности локальной истории**. Работать от требований: Android Keystore, offline, без лишнего ручного пароля, без тихой смены identity, без потери существующих сообщений, с безопасным crash-safe восстановлением. Не обещать результат, пока нет реализации и тестов. Первые файлы:
- src/lib/dexie-db.ts — таблицы и миграция истории, indexes; exportDexieDump/importDexieDump.
- src/lib/storage.ts, src/lib/safe-storage.ts, src/lib/p2p.ts — путь записи старых и новых сообщений, фолбэки, удаление.
- src/lib/crypto.ts, android/app/src/main/java/com/baurp/trivochat/SecureVaultPlugin.java, src/lib/identity-transfer.ts — KeyStore, fingerprint, перенос личных ключей.
- src/lib/backup.ts, src/lib/backup-crypto.ts, src/lib/backup-merge-policy.ts, src/lib/backup-validation.ts — обязательное безоткатное восстановление.
- src/lib/__tests__/identity-validation.test.ts, backup-merge-policy.test.ts, backup-validation.test.ts, hidden-message-migration.test.ts — начать с точных тестов.

**Независимая следующая P1 задача для быстрого продолжения:** `src/lib/onion-engine.ts` (deliveryListeners callback), `src/lib/delivery-status-policy.ts`, `src/lib/__tests__/delivery-status-policy.test.ts`. После build-298 состояние в IndexedDB гарантированно монотонно, но поздний асинхронный callback `sent` теоретически может оказаться после callback `delivered`. Добавить ограниченный per-ID tracker, tests на порядок событий, далее Dexie+ACK integration. Не менять содержимое сообщений и не снижать статус в storage.

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
