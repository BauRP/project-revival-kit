# AGENTS2.md — постоянные инструкции разработки Trivo Chat Elite

> Область действия: весь репозиторий BauRP/project-revival-kit, рабочая ветка chatgpt/trivo-security-compat-20261031. Этот документ дополняет существующий корневой AGENTS.md, созданный/управляемый Lovable. **AGENTS.md не изменять и не заменять**. По состоянию на 2026-11-06 вложенных AGENTS.md в репозитории нет; при каждой новой работе проверять появившиеся инструкции в конкретном каталоге. Этот документ не хранит изменяющиеся проценты, текущую историю коммитов или персональные данные.

## 0. ОБЯЗАТЕЛЬНО ПЕРЕД ЛЮБОЙ РАБОТОЙ (быстрый маршрут)

1. Открой актуальный корневой PROGRESS.md: там реальная рабочая ветка, последний проверенный кодовый коммит, текущие 20 направлений, инциденты, успешные CI и раздел «С чего продолжить в следующем чате». Затем прочитай корневой AGENTS.md, этот AGENTS2.md и применимые вложенные AGENTS.md (если появились). Даже если ИИ-платформа не читает AGENTS2.md автоматически, открой его самостоятельно.
2. Сверь HEAD ветки chatgpt/trivo-security-compat-20261031 с последним кодовым SHA в PROGRESS.md; запрашивай diff только новых коммитов. Если коммит только документационный, не делай повторный аудит исходников. Прежде чем менять код, убедись, что исходное состояние не опередило твой HEAD.
3. Сверь требования пользователя, PROGRESS.md и код. При конфликте: безопасность и утверждённые требования пользователя обязательны; фактическую реализацию определяет актуальный код. Устаревший roadmap/README не является доказательством работоспособности.
4. Самостоятельно собери крупный, но связный набор задач. Приоритет: уязвимости, потеря данных, зависания, блокирующие ошибки → отсутствие обязательных функций → прочие дефекты/производительность. Выполняй максимум достижимого, не распыляясь на несвязанные изменения.
5. Делай быстрые адресные проверки при редактировании, затем полный существующий CI/Android APK для законченного кодового пакета. Ошибки исправляй до завершения; не оставляй заведомо сломанную рабочую ветку.
6. При КАЖДОМ запросе, касающемся Trivo Chat Elite, даже если пользователь забыл напомнить, обнови один и тот же PROGRESS.md прямо в GitHub: выполненное, проверенное/непроверенное, ошибка, следующий шаг, проценты только если заслужены. Если изменена лишь документация или проведён аудит — зафиксируй факт, прирост готовности 0.
7. Все изменения записывай только в согласованную ветку; не трогай main, не force-push, не делай rebase/squash/amend уже опубликованной истории. Проверяй GitHub после записи.

## 1. Проект, реальные технологии и инфраструктура

- Приложение: Trivo Chat Elite, приватный Tor-v3 .onion P2P мессенджер; package ID com.baurp.trivochat. Нет обязательного сервера для хранения сообщений; режим офлайн для локальных функций. Никаких Firebase/Supabase/платных облачных AI API или обязательной регистрации.
- Web/UI: React 19, TypeScript, Vite 7, TanStack Router/Start, Tailwind CSS 4, Radix/shadcn, Lucide. Исходники в src/components, src/lib, src/hooks, src/contexts, src/routes и src/pages.
- Android: Capacitor 8.5.0, нативная Java-часть и Gradle/Java 21, Tor 0.4.5.7 от Guardian Project. Android minSdk 24 (Android 7), targetSdk 36 (Android 16). Целевой диапазон требований — Android 7–17, но APK-аудит НЕ подтверждает тестирование Android 17.
- Хранилище и защита: Dexie 4/IndexedDB, Web Crypto, tweetnacl/@noble; Android Keystore через SecureVaultPlugin; экспорт V2 AES-GCM + PBKDF2-SHA256 600000 итераций. **История в Dexie не полностью зашифрована**, настоящего ML-KEM/PQXDH нет; не говорить, что эти функции уже готовы.
- Tor: собственный Capacitor bridge TorTransport и Android FGS TorOnionService; native sealed-frame очередь существует в tor/NativeInboundQueue.java, хотя старый корневой AGENTS.md утверждает обратное. Сохранить AGENTS.md неизменным, но при разработке следовать текущему коду и проверке ACK/queue.
- Источники правды: актуальные package.json, bun.lock, tsconfig.json, eslint.config.js, .prettierrc, capacitor.config.ts, android/app/build.gradle, .github/workflows/android_build.yml и PROGRESS.md. Исторические README.md, ARCHITECTURE.md и roadmap.md читать при необходимости; их старые заявления проверять по коду.
- GitHub CI уже работает и кеширует Bun/Gradle. Не дублировать setup без потребности; нельзя заявлять green, пока в Actions статус не completed/success.

## 2. Карта кода: минимальные стартовые файлы по задачам

| Область | Начать с этих файлов | Проверить связанные зависимости |
|---|---|---|
| Tor identity/handshake | src/lib/crypto.ts; src/lib/onion-id.ts; src/lib/envelope.ts | src/lib/crypto-async.ts; src/lib/workers/crypto.worker.ts; src/lib/identity-transfer.ts |
| Tor отправка, ACK, входящая очередь, reconnect | src/lib/onion-engine.ts; src/lib/tor-native.ts; src/lib/inbound-durability.ts | src/lib/dispatch-commit.ts; src/lib/delivery-status-policy.ts; src/lib/inbound-frame-policy.ts; src/lib/inbound-message.ts; src/lib/dexie-db.ts |
| Android Tor и Native очередь | android/app/src/main/java/com/baurp/trivochat/tor/TorOnionService.java; android/app/src/main/java/com/baurp/trivochat/tor/NativeInboundQueue.java | android/app/src/main/java/com/baurp/trivochat/TorTransportPlugin.java; tor/Socks5Client.java (рядом); android/app/src/main/AndroidManifest.xml |
| Локальная история и её защита | src/lib/dexie-db.ts; src/lib/p2p.ts; src/lib/storage.ts; src/lib/safe-storage.ts; src/lib/local-record-crypto.ts; src/lib/local-record-key.ts | src/lib/crypto.ts; android/app/src/main/java/com/baurp/trivochat/SecureVaultPlugin.java; android/app/src/main/java/com/baurp/trivochat/VaultBackupFiles.java; src/lib/hidden-message-migration.ts; src/lib/conversation-index-policy.ts. **Crypto/key подключены только к временным частям получаемых Tor файлов; сообщения, lifecycle, contacts, готовые blobs остаются plaintext**, не обещать зашифрованную историю |
| Резервные копии и миграция identity | src/lib/backup.ts; src/lib/backup-crypto.ts; src/lib/backup-validation.ts; src/lib/identity-transfer.ts; src/lib/backup-snapshot-policy.ts; src/lib/backup-media-codec.ts; src/lib/backup-export-privacy.ts | src/lib/backup-merge-policy.ts; src/lib/backup-package.ts; src/lib/auto-backup.ts; src/lib/one-time-policy.ts; src/lib/dexie-db.ts. V3 export: единый Dexie snapshot, real media size budget, bounded Base64 chunks, consumed one-time media исключается. Не объявлять encrypt-at-rest для messages |
| Медиа, большие файлы, одноразовые вложения | src/lib/media-store.ts; src/lib/media-chunks.ts; src/lib/media-retry-policy.ts; src/lib/security-scan.ts; src/lib/partial-chunk-vault.ts; src/lib/legacy-chunk-migration.ts | src/lib/blob-request-policy.ts; src/lib/message-deletion-policy.ts; src/lib/onion-engine.ts; src/lib/dexie-db.ts; local-record-crypto.ts + local-record-key-store.ts. Android new partial_chunks encrypted (build-322), verified legacy upgrade on resume (build-323); Web preview remains legacy |
| Удаление/редактирование, защита истории | src/lib/sync/message-lifecycle.ts; src/lib/history-protection.ts; src/lib/history-protection-policy.ts | src/lib/lifecycle-auth.ts; src/lib/message-deletion-policy.ts; src/components/ChatRoom.tsx |
| Отложенные сообщения | src/lib/outbox.ts; src/lib/scheduled-policy.ts; src/lib/scheduled-encryption.ts | src/components/ScheduleSheet.tsx; src/lib/onion-engine.ts; SecureVaultPlugin.java |
| Профили и реакции | src/lib/profile.ts; src/lib/profile-wire.ts; src/lib/reactions.ts | src/lib/profile-policy.ts; src/lib/reaction-policy.ts; src/lib/onion-engine.ts |
| Уведомления и настройки | src/lib/notifications.ts; src/lib/notification-policy.ts; src/components/SettingsPage.tsx | src/lib/chat-preferences.ts; src/components/SecurityDashboard.tsx |
| Offline speech / translation | src/components/TranscriptionPlate.tsx; src/lib/stt-cache.ts; src/lib/transcribe.functions.ts | src/lib/server/transcribe.server.ts; src/lib/translation-config.ts; настоящая встроенная STT-модель пока отсутствует |
| Основные UI-переходы | src/components/ChatRoom.tsx; src/components/TabbedWorkspace.tsx; src/routes/index.tsx | src/routes/__root.tsx; src/pages/Index.tsx; src/hooks; src/contexts |
| Android безопасность/экраны | android/app/src/main/java/com/baurp/trivochat/MainActivity.java; android/app/src/main/AndroidManifest.xml | android/app/src/main/java/com/baurp/trivochat/SecureViewPlugin.java; SecureVaultPlugin.java; android/app/build.gradle |
| Тесты и сборка | src/lib/__tests__/*.test.ts; .github/workflows/android_build.yml; package.json | tsconfig.json; vite.config.ts; capacitor.config.ts; scripts/stage-web.mjs, fix-relative-assets.mjs, verify-web-dir.mjs |

Файлы, которые требуют особенно узкого чтения: src/lib/onion-engine.ts (~1300 строк) и src/components/ChatRoom.tsx (очень большой компонент). Ищи функции/диапазоны; не читай их целиком по каждому запросу.

## 3. Неизменяемые инварианты безопасности и пользовательских данных

1. Источник личности — канонический Tor v3 onion адрес, выведенный из Ed25519 signing key. Сетевые кадры обязательно шифровать и подписывать до TorTransport.send. Не добавлять серверный идентификатор пользователя и не изобретать альтернативный peer ID.
2. Успешная отправка сокета означает sent, не delivered. Delivered подтверждать только аутентифицированным ACK после долговременной записи на стороне получателя. Статусы pending → sent → delivered → read только монотонно; события UI тоже не должны откатываться.
3. NativeInboundQueue сохраняет только sealed frames атомарно до транспортного ACK; native запись удаляется только после безопасной записи/обработки в JS Dexie. Для восстановления после перезапуска сохранять повторяемость без двойного уведомления и без исчезнувших сообщений.
4. Нельзя оживлять удалённое сообщение или одноразовое вложение через старую резервную копию, повторный подписанный кадр, запоздалый чанк или параллельную миграцию. Tombstones долговечны; запреты проверяются вместе с записью в одну Dexie transaction.
5. Android Keystore failure не равен отсутствию identity. Запрещена молчаливая генерация новой личности или перенос чужого identity на непустое устройство. Миграция без потери данных: сначала durable запись и проверка, затем удаление старого plaintext; поддерживать retry after crash.
6. Backup V2 шифрован и валидируется перед импортом. Повреждённый архив не должен заменить исправный. Не стирать ручные архивы вместе с ротацией автоматических; не активировать старые outgoing frames при restore.
7. Реальный PQXDH/ML-KEM НЕ реализован, нельзя включать ложный green badge. MIME/signature проверки вложений не заменяют антивирус. Offline STT НЕ реализован; не маскировать отсутствие облачным сервисом.
8. Опция «Защита истории переписки» отдельна для каждого чата. Оба выбора «Удалить у себя» и «Удалить у всех» остаются активными; чужие «Удалить у всех»/«Редактировать» запрещаются на стороне получателя с сообщением «У пользователя включена защита истории переписки.», локальное удаление разрешено.
9. Направление №13 (жалобы/репорты) поставлено пользователем на паузу. Не разрабатывать, не передавать куда-либо контент чатов без явного разрешения.
10. Android 7–17, жесты/3-кнопочная навигация, клавиатура, поворот, системные insets; не отключать функции или безопасность ради устранения зависаний. Проверять таймаут, отмену, single-flight, память, освобождение media resources, WebView/FGS lifecycle.

## 4. Стандарты кода и жизненный цикл ошибок

- Сохраняй существующий TypeScript/React функциональный стиль (ESM import/export, async/await, React hooks), Java-классы в соответствующих пакетах Android. Именование: файлы src/lib в kebab-case, React компоненты в PascalCase, функции в camelCase, types/interfaces в PascalCase. Применяй текущие правила Prettier: двойные кавычки, точки с запятой, хвостовые запятые, ширина 100.
- Изменяй точечно и сохраняй совместимость экспортов, wire-framing, IndexedDB schema и прошлых резервных копий; новые wire версии требуют negotiation и тестов для двух несовпадающих версий APK.
- Входящие подписанные Tor payload всё ещё недоверенные данные. Проверяй типы, длины, sender/recipient, timestamps, id, media metadata и ограничения размера ДО записи, ACK, disk access и UI. Не делай String(object) вместо валидации.
- Транзакции Dexie: операции read/modify/write с общими инвариантами проводить атомарно. Не ждать сетевые вызовы внутри IndexedDB transaction. Избегать синхронного чтения больших Blob и toArray всей истории/очереди, когда доступны индексы, первичные ключи и курсоры.
- При асинхронной работе ограничивать параллелизм, повторные попытки, очередь памяти и таймауты. При stop/unmount отменять/очищать работы так, чтобы поздний результат не восстанавливал удалённые файлы или ранее прекращённую камеру/запись.
- Ошибки разграничивай: подтверждённая кодом причина, гипотеза, CI-результат и runtime-свидетельство — разные уровни достоверности. Не скрывай ошибки записи важных данных (identity, истории, backup) через пустой catch или «успех» после failure.
- Новые важные алгоритмы выноси в небольшие тестируемые функции и дополняй Vitest: граничные значения, нарушение формата, повторы, гонки, падение/рестарт, backward compatibility. Не добавляй пустые тесты, фальшивые метрики или заглушки вместо функции.
- Изменяя общий интерфейс, проверь всех вызывающих и тесты. Новые библиотеки допускаются только при обосновании: совместимость Android 7–17/Capacitor, офлайн, лицензия, размер APK, производительность, угрозы цепочки поставки.
- Не сохраняй приватные ключи, восстановительные фразы, токены, реальные onion адреса пользователей, содержимое сообщений или персональные данные в журнале, коммитах, тестовых фикстурах и логах.

## 5. Быстрые проверки и полный Android CI — только реальные команды

**Во время написания кода (не вся APK после каждой строки):**
- bunx vitest run — модульные тесты; при необходимости Vitest можно направить на конкретный существующий файл теста.
- bunx tsc --noEmit --pretty false — TypeScript.
- bun run lint — ESLint согласно package.json; базовая CI не гарантирует отдельный lint шаг, отмечай когда фактически запускал.
- bun install --frozen-lockfile — восстановить зависимости один раз, если рабочая копия новая. package manager Bun 1.3.3; не менять bun.lock без изменения зависимостей.

**После крупного пакета: полный существующий .github/workflows/android_build.yml, либо локально по фактической последовательности:**
1. CAP_BUILD=1 bun run build
2. node scripts/stage-web.mjs
3. node scripts/fix-relative-assets.mjs
4. node scripts/verify-web-dir.mjs
5. npx cap sync android
6. cd android
7. ./gradlew clean assembleDebug --no-daemon --stacktrace

GitHub Actions выполняет Bun install, Vitest, tsc, web build/staging, Capacitor sync, Gradle debug APK, аудит aapt (minSdk 24/targetSdk 36), четыре ABI libtor.so (arm64-v8a, armeabi-v7a, x86_64, x86) и загрузку универсальной APK в GitHub Release с тегом build-N. Нужны GitHub Actions status **completed/success** и точный SHA; запущенная, остановленная или неисполненная проверка не равна успешной. Release APK не считается автоматически проверенной по debug CI.

Кэширование Bun downloads через actions/cache@v4 и Gradle через setup-java уже присутствует. Не плодить вторую инфраструктуру. Каталоги node_modules, dist, .output, .vinxi, www и стандартные build outputs генерируются: не коммитить/не править результат сборки вручную. WebView webDir=www, строится строго из настоящего build через scripts/stage-web.mjs. Файл bun.lock является входным lock-файлом, а не кешем.

Для чисто документационных изменений не выдавай прежнюю APK за новую и не делай лишнюю Gradle сборку, если код/конфиг не менялись; достаточно проверить файлы, ссылку и diff. Результаты и ограничения обязательно фиксировать в PROGRESS.md.

## 6. Быстрый цикл GitHub, диагностика и безопасность ветки

1. Перед редактированием получить актуальный branch ref/HEAD и соответствующий tree. Проверить diff от последней кодовой базы в PROGRESS.md; читать лишь нужные изменённые пути.
2. При наличии GitHub API/connector: собрать связанные изменения нескольких файлов в одном tree на основе текущего base tree, затем create_commit(parent=head) и безопасный update_ref с expected_sha=head; проверить результат чтением новых файлов и ref. При изменившемся HEAD заново прочитать diff и согласовать, не переписывать чужие правки.
3. Если GitHub требует разрешения, ждать обычное подтверждение «Разрешить один раз» от пользователя. Не запрашивать «Всегда разрешать», не обходить контроль доступа. Ни main, ни Lovable-managed AGENTS.md не трогать.
4. Большой пакет кода завершён, когда тесты + web + Android APK реально прошли и сохранены. Если CI красная — найти конкретный failed step/лог, исправить первопричину и повторить; не называть пакет проверенным до зелёного результата.
5. После проверки записать фактическую работу в PROGRESS.md, сохранить его в той же ветке. При обычном запросе о проекте журнал обновляется **даже без изменения кода**. Для документационного изменения прогресс функций остаётся прежним.
6. Если основная задача заблокирована, записать конкретный блокер и перейти к независимому P0/P1 из PROGRESS.md; не тратить запуск на повторные бесплодные попытки.

**Только для пользовательских проверок:** установка APK на личный телефон, сценарии на двух физически отдельных устройствах и специфические OEM-прошивки отделяются от программного списка незавершённых задач. Не понижать процент уже проверенной программной работы из-за отсутствия доступа к устройству пользователя.

## 7. Разделение ролей документов

- **AGENTS.md:** существующие инструкции Lovable и проекта; сохранять без изменений.
- **AGENTS2.md (этот файл):** долгосрочные правила разработки и ключевая карта файлов; обновлять только при изменениях архитектуры, инструментов, постоянных требований и ограничений.
- **PROGRESS.md:** единый постоянно обновляемый журнал с текущим HEAD, багами, тестами, сборками, процентами по всем 20 направлениям, приоритетами и точкой продолжения. **Обновлять при КАЖДОМ запросе по Trivo Chat Elite**, даже без напоминания и при нулевых изменениях кода. Не создавать альтернативный журнал.

---

## 8. Как мы работаем по всем направлениям

**Обязательный текст пользователя, сохранённый дословно, без правок:**

Возьми максимум работы по всем направлениям проекта и делай по этому правилу:

1. Не перечитывай весь проект, если нужный контекст уже известен. Изучай только необходимые файлы и связанные участки кода.
2. Не запускай отдельную APK-сборку после каждого мелкого изменения. Объединяй изменения в крупные логические пакеты.
3. Самостоятельно объединяй взаимосвязанные задачи в крупные блоки. Выполняй максимально большой объём реальной разработки за один запуск.
4. Сначала занимайся наиболее незавершёнными направлениями и отсутствующими функциями. Критические ошибки, зависания, безопасность и риск потери данных имеют наивысший приоритет.
5. Не трать время на длинные промежуточные отчёты. Кратко сообщай о существенном прогрессе, но основное время уделяй коду.
6. После каждого крупного пакета обязательно проводи автоматические тесты и полноценную сборку приложения. Если проверки выявили ошибки, исправляй их и повторяй.
7. Показывай готовность каждого направления, прирост в процентах или долях процента и общую готовность. Повышай показатели только за реально выполненную и проверенную работу.
8. Если одна задача заблокирована, не зацикливайся. Переходи к другим доступным направлениям.
9. Не останавливайся после первого успешно выполненного блока. Последовательно переходи к следующему, пока позволяют инструменты и ограничения текущего запуска.
10. Сохраняй изменения только в согласованной рабочей ветке GitHub. Не трогай main без моего разрешения.
11. Не включай в незавершённую программную работу действия, которые технически не можешь выполнить, например установку APK на мой телефон. Завершай доступную работу в коде, проводи автоматические проверки и сборку. Проверки, которые должен сделать я, указывай отдельно, не снижая из-за них процент готовности программной части.

Главная цель: максимальное количество полностью реализованных и автоматически проверенных функций за один запуск, а не максимальное количество коммитов, отчётов или мелких исправлений.
