# ARCHITECTURE.md — Trivo Sync Elite (Trivo Chat)

## 1. Обзор архитектуры
**Trivo Sync Elite** (`com.baurp.trivochat`) — это защищенное децентрализованное мобильное и веб-приложение (мессенджер) с асинхронной P2P-синхронизацией, сквозным шифрованием (E2EE) и возможностью анонимизации трафика.

Приложение спроектировано по принципу **Zero-Knowledge (Нулевое Доверие)**: серверы или узлы связи не имеют доступа к содержимому переписки, ключам шифрования или персональным данным пользователей.

---

## 2. Технологический стек

### Frontend & UI Shell
* **Язык и Фреймворк:** React 19, TypeScript, Vite 7, TanStack Router/Start.
* **Стилизация:** Tailwind CSS, Shadcn UI / Radix UI компоненты.
* **Иконки:** Lucide React.
* **Состояние и Контексты:** React Context API (`IdentityContext`, `LanguageContext`, `ThemeContext`).

### Мобильная платформа & Native Layer (Android)
* **Среда гибридной сборки:** Capacitor 8.5.0 (`capacitor.config.ts`).
* **Нативный язык:** Java (Android SDK).
* **Кастомные нативные плагины:**
  * `TorTransportPlugin.java` — управление анонимным Onion-трафиком и SOCKS5 прокси внутри сети Tor (`TorOnionService`, `Socks5Client`, `OnionFrameQueue`).
  * `tor/TorNativeSupport.java` — отложенная и защищённая загрузка `libtor.so`.

### P2P, Сеть и Хранение
* **Хранение и обмен:** только локальная Dexie/IndexedDB + P2P-доставка кадров через Tor onion service (никаких внешних БД и узлов).
* **Сетевой менеджер:** `connection-manager.ts` (контроль соединений, фолбэки, восстановление связи).
* **Локальное хранилище:** IndexedDB / LocalStorage с шифрованием данных.

### Безопасность и Криптография
* **Шифрование:** Web Crypto API, асинхронные воркеры (`crypto-async.ts`, `crypto.worker`).
* **Биометрия:** Native Biometrics (`useBiometricAuth`).
* **Защита запуска:** `boot-guard.ts` (проверка целостности окружения при старте).

---

## 3. Полная структура каталогов проекта

```text
trivo-sync-elite-main/
├── .github/workflows/
│   └── android_build.yml       # CI/CD автоматизация сборки Android APK
├── android/                    # Android нативный проект (Capacitor)
│   └── app/src/main/java/com/baurp/trivochat/
│       ├── MainActivity.java           # Точка входа в нативное приложение
│       ├── TorTransportPlugin.java     # Capacitor плагин для Tor
│       └── tor/                        # Реализация SOCKS5 и Onion службы
│           ├── OnionFrameQueue.java    # Очередь кадров/пакетов
│           ├── Socks5Client.java       # Клиент SOCKS5
│           ├── TorOnionService.java    # Фоновый сервис Tor
│           └── TorNativeSupport.java   # Ленивая загрузка JNI-рантайма tor
├── src/
│   ├── assets/                 # Иконки приложения (trivo-icon.png, app-icon.png)
│   ├── components/             # Модули интерфейса
│   │   ├── ui/                 # Атомарные UI компоненты (Shadcn UI)
│   │   ├── ChatRoom.tsx        # Главный экран активного чата
│   │   ├── ChatList.tsx        # Список диалогов и контактов
│   │   ├── CallScreen.tsx      # Экран голосовых и видеовызовов
│   │   ├── RoundVideoRecorder.tsx # Запись круглых видеосообщений
│   │   ├── AudioWaveformPlayer.tsx# Волновое воспроизведение голосовых
│   │   ├── OneTimeViewer.tsx   # Одноразовый просмотр фото/видео
│   │   ├── SecurityDashboard.tsx # Панель состояния безопасности
│   │   ├── SecurityScanOverlay.tsx# Сканер угроз и уязвимостей
│   │   ├── DisappearingMessagesModal.tsx # Настройка исчезающих сообщений
│   │   ├── TranslationPlate.tsx# Панель встроенного перевода
│   │   └── ...                 # Папки, выбор эмодзи, профиль, настройки
│   ├── contexts/               # Глобальное состояние
│   │   ├── IdentityContext.tsx # Локальная идентичность и ключи шифрования
│   │   ├── LanguageContext.tsx # Локализация и выбор языка (RU/KK/EN)
│   │   └── ThemeContext.tsx    # Темы оформления (Dark/Light)
│   ├── hooks/                  # Кастомные хуки React
│   │   ├── useBiometricAuth.ts # Сканер отпечатка / FaceID
│   │   ├── useVoiceRecorder.ts # Запись аудиосообщений
│   │   ├── useFolders.ts       # Кастомная группировка чатов по папкам
│   │   └── useBackNavigation.ts# Обработка нативной кнопки "Назад"
│   ├── i18n/
│   │   └── translations.ts     # База текстовых переводов
│   └── lib/                    # Криптография, сеть и сервисы
│       ├── connection-manager.ts# P2P соединение и синхронизация
│       ├── crypto-async.ts      # Шифрование, генерация ключей и HASH
│       ├── boot-guard.ts        # Защищенный стартовый загрузчик
│       ├── backup.ts            # Резервное копирование и экспорт
│       ├── layout-metrics.ts    # Метрики раскладки (без рекламных отступов)
│       ├── home-navigation.ts   # Относительная навигация "домой" (file://)
│       ├── support-nlp-engine.ts# Офлайн NLP.js движок ассистента
│       └── workers/             # crypto.worker.ts, nlp.worker.ts
├── scripts/fix-relative-assets.mjs # Приведение путей dist/ к относительным
├── capacitor.config.ts         # Конфигурация мобильной сборки (типизированная)
└── package.json                # Зависимости и скрипты проекта
