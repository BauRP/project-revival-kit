import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Globe,
  Shield,
  Lock,
  Network,
  Route as RouteIcon,
  BellRing,
  BatteryCharging,
  Fingerprint,
} from "lucide-react";

interface TransparencyPageProps {
  onBack: () => void;
}

type Lang = "en" | "ru";

interface Topic {
  id: string;
  icon: typeof Shield;
  title: Record<Lang, string>;
  summary: Record<Lang, string>;
  body: Record<Lang, string[]>;
}

const TOPICS: Topic[] = [
  {
    id: "tor", icon: Shield,
    title: {"en":"Tor network transport","ru":"Передача сообщений через Tor"},
    summary: {"en":"Tor onion transport is used for Trivo chat frames, not every device connection.","ru":"Tor используется для сообщений Trivo, но не для всего интернет-трафика устройства."},
    body: {"en":["Messages sent through the Trivo transport are sealed and delivered over a local Tor SOCKS5 connection to the other user's v3 onion service. The native Android service buffers inbound encrypted frames when the WebView is asleep.","This does not mean every connection made by Android or by other app features goes through Tor. Language-pack downloads, system updates and external links may use other network routes. Tor lowers exposure of network addresses, but cannot eliminate every traffic-analysis or device compromise risk.","A stable onion address comes from the signing identity. A service restarted after process death can recover that identity from an Android Keystore-protected local copy; it must refuse startup if recovery fails."],"ru":["Сообщения Trivo передаются через локальный SOCKS5-интерфейс Tor на onion-службу собеседника. Нативная Android-служба сохраняет входящие зашифрованные пакеты, когда интерфейс приложения не работает.","Это не означает, что абсолютно весь трафик Android или других функций приложения проходит через Tor. Загрузка языковых пакетов, системные обновления и внешние ссылки могут пользоваться другими маршрутами. Tor снижает раскрытие сетевых адресов, но не гарантирует защиту от любого анализа трафика и взлома устройства.","Постоянный onion-адрес связан с ключами личности. После перезапуска процесса служба может восстановить прежний ключ из локальной копии, защищённой Android Keystore. Если восстановление невозможно, служба не должна создавать другую личность вместо прежней."]},
  },
  {
    id: "e2ee", icon: Lock,
    title: {"en":"Current message encryption","ru":"Текущее шифрование сообщений"},
    summary: {"en":"Authenticated NaCl encryption; PQXDH and forward secrecy are not implemented.","ru":"Шифрование NaCl с проверкой подлинности; PQXDH и прямая секретность не реализованы."},
    body: {"en":["The messenger uses Ed25519 signatures, X25519 key agreement and NaCl authenticated encryption for Tor messaging frames. A recipient rejects messages with invalid signatures or authentication tags.","The application does not implement a reviewed post-quantum key exchange or a double-ratchet protocol. The disabled PQXDH compatibility function intentionally reports that this capability is unavailable. Do not interpret ordinary encryption as post-quantum protection.","End-to-end encryption protects messages in transit. It does not automatically mean that copies held in local IndexedDB or shown on screen are encrypted at rest."],"ru":["Для кадров сообщений через Tor используются подписи Ed25519, согласование ключей X25519 и аутентифицированное шифрование NaCl. Неверные подписи и теги аутентификации отклоняются.","В приложении пока нет проверенного постквантового обмена ключами и протокола Double Ratchet. Заглушка PQXDH специально сообщает об отсутствии такой возможности. Обычное шифрование нельзя называть постквантовым.","Сквозное шифрование защищает переписку при передаче. Оно не означает, что копии сообщений в локальной базе IndexedDB или на экране автоматически зашифрованы при хранении."]},
  },
  {
    id: "storage", icon: Fingerprint,
    title: {"en":"Local data and identity keys","ru":"Локальные данные и ключи личности"},
    summary: {"en":"Identity and scheduled text are Keystore-protected; the full chat database is not.","ru":"Ключи и отложенный текст защищены Keystore, вся база переписки пока нет."},
    body: {"en":["The Android identity vault encrypts its recoverable key material with a non-exportable Android Keystore key. Scheduled outgoing message text is encrypted before its IndexedDB queue write. Older scheduled entries are migrated when possible.","The main Dexie message database and several older metadata stores are not yet fully encrypted at rest. Device unlock and app access controls matter. Do not store sensitive conversations on a device you do not trust.","Private speech transcripts are no longer transmitted to a hosted AI gateway or kept as plaintext browser storage. Offline speech recognition needs a separately bundled and validated model."],"ru":["Хранилище личности Android шифрует локальную копию ключей с помощью неэкспортируемого ключа Android Keystore. Текст отложенных сообщений шифруется до записи в очередь IndexedDB; старые записи при возможности переводятся в новый формат.","Основная база переписки Dexie и часть старых метаданных ещё не полностью зашифрованы при хранении. Защита экрана и самого устройства остаётся важной. Не следует считать локальную базу безопасной на скомпрометированном телефоне.","Голосовые расшифровки больше не отправляются внешнему AI-сервису и не хранятся открытым текстом в браузерных настройках. Для полноценного офлайн-распознавания нужна отдельная проверенная модель."]},
  },
  {
    id: "backup", icon: Network,
    title: {"en":"Encrypted backups and account transfer","ru":"Зашифрованные копии и перенос аккаунта"},
    summary: {"en":"Password-encrypted archives include chat history and keys; automatic copies are opt-in.","ru":"Зашифрованные архивы с перепиской и ключами; автоматические копии по согласию."},
    body: {"en":["New portable backups are encrypted using a password-derived key with PBKDF2-SHA256 and AES-256-GCM. They contain conversation history, attachments and identity keys, subject to the format's size limits.","On Android, automatic backups can run while the app is active after explicit setup. Their credential is wrapped by Keystore; older automatic snapshots are pruned while manually exported copies are kept. This is not an always-running WorkManager backup.","Restoring a different identity requires explicit confirmation on an empty installation. An exported backup in Documents may remain after account deletion: remove it separately if you no longer want it."],"ru":["Новые переносимые резервные копии шифруются паролем с PBKDF2-SHA256 и AES-256-GCM. В архив попадают переписка, вложения и ключи личности в пределах текущих ограничений размера.","На Android автоматические копии могут создаваться при работающем приложении после явного включения. Пароль защищён Android Keystore; старые автоматические копии очищаются, а ручные архивы сохраняются. Это пока не постоянное фоновое резервирование через WorkManager.","Перенос другой личности требует отдельного подтверждения на пустой установке. Экспортированный архив в папке Documents может остаться после удаления аккаунта. При необходимости удалите его отдельно."]},
  },
  {
    id: "background", icon: BellRing,
    title: {"en":"Background availability and delivery","ru":"Фоновый приём и доставка"},
    summary: {"en":"The native Tor receiver persists inbound frames; background delivery still has limits.","ru":"Нативный Tor сохраняет входящие кадры; фоновая доставка всё ещё ограничена."},
    body: {"en":["Android uses a foreground service with a persistent notification to keep a Tor onion listener available. On Android 14 and later the service uses the remote-messaging foreground-service type instead of time-limited dataSync.","Incoming sealed frames are persisted by the native service. When the WebView resumes, it processes the queue and updates chats. The JavaScript outgoing queue can resume its retries, but it does not provide a verified, fully independent native sender when the interface is stopped.","Android may stop background processes due to system policy or battery restrictions. Reliability across Android 7–17 and between two real handsets still needs device testing."],"ru":["Android использует foreground-службу с постоянным уведомлением, чтобы поддерживать onion-приёмник. Начиная с Android 14 служба использует тип remoteMessaging вместо ограниченного по времени dataSync.","Входящие зашифрованные кадры сохраняет нативная служба. После пробуждения интерфейса WebView очередь обрабатывается, а чаты обновляются. Очередь исходящих сообщений на JavaScript возобновляет повторы, но полноценный независимый нативный отправитель при закрытом интерфейсе пока не подтверждён.","Android может завершать фоновые процессы по системным причинам и ради экономии батареи. Надёжность на Android 7–17 и между двумя реальными телефонами ещё необходимо проверить."]},
  },
  {
    id: "limits", icon: BatteryCharging,
    title: {"en":"Privacy limits and user controls","ru":"Ограничения защиты и настройки"},
    summary: {"en":"Security claims are limited to implemented and verified features.","ru":"Защитные возможности описываются только в пределах реализации и проверок."},
    body: {"en":["The optional encrypted Tor cover frames are experimental. They consume traffic and battery and do not amount to Vuvuzela, Alpenhorn or guaranteed traffic-analysis resistance.","Offline attachment signature checks block several suspicious formats, but they are not malware or antivirus scanning. One-time media is removed on first viewing, with a native screen-capture protection attempt; cameras or compromised devices are outside its protection.","A successful CI build means tests, type-checking and packaging passed. It does not prove a security audit, full compatibility with every Android device or complete resilience against targeted attacks."],"ru":["Дополнительные зашифрованные пустые кадры Tor включаются отдельно и остаются экспериментальными. Они расходуют трафик и батарею и не обеспечивают уровень анонимности Vuvuzela, Alpenhorn или гарантированную защиту от анализа трафика.","Локальная проверка сигнатур вложений блокирует некоторые подозрительные форматы, но не является антивирусом. Одноразовые вложения удаляются при первом открытии, а Android пытается заблокировать снимки экрана. Внешняя камера и взломанный телефон остаются вне этой защиты.","Успешная сборка CI означает, что прошли тесты, проверка типов и упаковка приложения. Она не заменяет аудит безопасности, испытания каждого Android-устройства и проверку устойчивости к целевым атакам."]},
  },
];

const COPY = {
  header: { en: "Technical Transparency", ru: "Техническая прозрачность" },
  intro: {
    en: "Exactly how Trivo Chat Elite handles your traffic, your keys and your data — written from the actual implementation, not from marketing.",
    ru: "Как именно Trivo Chat Elite обращается с вашим трафиком, ключами и данными — описано по реальной реализации, а не по маркетингу.",
  },
  back: { en: "Back", ru: "Назад" },
} as const;

const TransparencyPage = ({ onBack }: TransparencyPageProps) => {
  const [lang, setLang] = useState<Lang>("en");
  const [openId, setOpenId] = useState<string | null>(null);

  const active = useMemo(() => TOPICS.find((t) => t.id === openId) ?? null, [openId]);

  const languageToggle = (
    <button
      type="button"
      onClick={() => setLang((prev) => (prev === "en" ? "ru" : "en"))}
      className="ml-auto flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors active:bg-gray-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:active:bg-neutral-800"
      aria-label="Toggle language"
    >
      <Globe size={14} />
      {lang === "en" ? "EN" : "RU"}
    </button>
  );

  if (active) {
    const Icon = active.icon;
    return (
      <div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-neutral-950 dark:text-neutral-100">
        <div className="flex shrink-0 items-center gap-3 px-3 pb-2 pt-4">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="rounded-lg p-2 text-gray-700 transition-colors active:bg-gray-200 dark:text-neutral-200 dark:active:bg-neutral-800"
            aria-label={COPY.back[lang]}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="truncate text-base font-bold">{active.title[lang]}</h1>
          {languageToggle}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-10 scrollbar-hide">
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold leading-tight">{active.title[lang]}</h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-neutral-400">
                {active.summary[lang]}
              </p>
            </div>
          </div>

          <article className="space-y-4">
            {active.body[lang].map((paragraph, index) => (
              <p
                key={index}
                className="text-[13.5px] leading-relaxed text-gray-700 dark:text-neutral-300"
              >
                {paragraph}
              </p>
            ))}
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="flex shrink-0 items-center gap-3 px-3 pb-2 pt-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-2 text-gray-700 transition-colors active:bg-gray-200 dark:text-neutral-200 dark:active:bg-neutral-800"
          aria-label={COPY.back[lang]}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">{COPY.header[lang]}</h1>
        {languageToggle}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 scrollbar-hide">
        <p className="mb-4 px-1 text-xs leading-relaxed text-gray-500 dark:text-neutral-400">
          {COPY.intro[lang]}
        </p>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {TOPICS.map((topic, index) => {
            const Icon = topic.icon;
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => setOpenId(topic.id)}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-gray-100 dark:active:bg-neutral-800 ${
                  index > 0 ? "border-t border-gray-100 dark:border-neutral-800" : ""
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">
                    {topic.title[lang]}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-gray-500 dark:text-neutral-400">
                    {topic.summary[lang]}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-gray-400" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TransparencyPage;
