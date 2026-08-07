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
    id: "tor",
    icon: Shield,
    title: { en: "Tor Network Protection", ru: "Защита сети Tor" },
    summary: {
      en: "Every byte leaves your device inside the Tor circuit.",
      ru: "Каждый байт покидает устройство внутри цепочки Tor.",
    },
    body: {
      en: [
        "Trivo Chat Elite ships a real Tor daemon inside the Android application (the Guardian Project tor-android build, controlled over the standard Tor control port with jtorctl). When the app starts, that daemon bootstraps its own circuits and then publishes a version 3 Onion Service that belongs exclusively to your handset. The private key of that service is generated on the device, stored in the app's private storage and never transmitted anywhere.",
        "Because the address is an Onion Service, there is no IP address to leak. Two Trivo users never learn each other's network location: the connection is established inside the Tor network itself, at the rendezvous point, and both sides only ever see a 56-character .onion identifier. All outbound traffic is pushed through the local SOCKS5 port opened by the daemon, so nothing bypasses the circuit — there is no fallback to a plain HTTPS server anywhere in the messaging path.",
        "This also means Trivo works in environments where classic messengers are blocked: there is no central domain, no API host, and no push gateway that a network operator can filter. If the circuit is temporarily unavailable, frames are kept in the encrypted local queue and delivered as soon as Tor is bootstrapped again.",
      ],
      ru: [
        "Trivo Chat Elite содержит настоящий демон Tor внутри Android-приложения (сборка tor-android от Guardian Project, управляемая через стандартный control-порт с помощью jtorctl). При запуске демон строит собственные цепочки и публикует Onion Service версии 3, принадлежащий только вашему устройству. Приватный ключ этой службы генерируется на устройстве, хранится в приватном хранилище приложения и никуда не передаётся.",
        "Поскольку адрес является Onion Service, утечь IP-адресу просто неоткуда. Два пользователя Trivo никогда не узнают сетевое расположение друг друга: соединение устанавливается внутри самой сети Tor, в точке рандеву, и обе стороны видят только 56-символьный идентификатор .onion. Весь исходящий трафик проходит через локальный порт SOCKS5, открытый демоном, поэтому ничто не обходит цепочку — в тракте доставки сообщений нет запасного HTTPS-сервера.",
        "Благодаря этому Trivo работает там, где классические мессенджеры заблокированы: нет центрального домена, нет API-хоста и нет push-шлюза, который оператор связи мог бы отфильтровать. Если цепочка временно недоступна, кадры хранятся в зашифрованной локальной очереди и отправляются сразу после восстановления Tor.",
      ],
    },
  },
  {
    id: "e2ee",
    icon: Lock,
    title: { en: "End-to-End Encryption (NaCl)", ru: "Сквозное шифрование (NaCl)" },
    summary: {
      en: "X25519 key exchange, XSalsa20-Poly1305 payloads, Ed25519 signatures.",
      ru: "Обмен ключами X25519, полезная нагрузка XSalsa20-Poly1305, подписи Ed25519.",
    },
    body: {
      en: [
        "Your identity consists of two key pairs generated locally with TweetNaCl the first time the app runs: an Ed25519 pair used to sign everything you send, and an X25519 pair used for key agreement. Both secret keys stay in device storage; only the public halves are ever shared, and they travel with each frame so the receiving device can verify authorship immediately.",
        "Message bodies are sealed with NaCl box — X25519 key agreement combined with the XSalsa20-Poly1305 authenticated cipher — using a fresh 24-byte random nonce for every single message. Authenticated encryption means a modified ciphertext is not merely garbled, it is rejected outright: the Poly1305 tag fails and the frame is dropped before it ever reaches the chat list.",
        "On top of that, every frame carries an Ed25519 detached signature computed over its canonical form (kind, sender, recipient, timestamp and body). The receiver recomputes that canonical string and verifies the signature before doing anything with the frame, so replayed, forged or reordered frames are discarded. All of these operations run in a dedicated Web Worker, off the interface thread, so cryptography never freezes the UI.",
      ],
      ru: [
        "Ваша личность состоит из двух пар ключей, сгенерированных локально библиотекой TweetNaCl при первом запуске: пара Ed25519 подписывает всё, что вы отправляете, а пара X25519 используется для согласования ключей. Оба секретных ключа остаются в хранилище устройства; наружу уходят только публичные части, и они передаются вместе с каждым кадром, чтобы получатель мог сразу проверить авторство.",
        "Тела сообщений запечатываются через NaCl box — согласование ключей X25519 в связке с аутентифицированным шифром XSalsa20-Poly1305 — со свежим случайным 24-байтным nonce для каждого сообщения. Аутентифицированное шифрование означает, что изменённый шифротекст не просто испортится: тег Poly1305 не сойдётся, и кадр будет отброшен до того, как попадёт в список чатов.",
        "Сверх этого каждый кадр несёт отсоединённую подпись Ed25519 по канонической форме (тип, отправитель, получатель, время и тело). Получатель заново собирает эту каноническую строку и проверяет подпись, прежде чем что-либо делать с кадром, поэтому повторно проигранные, поддельные или переставленные кадры отбрасываются. Все эти операции выполняются в отдельном Web Worker, вне потока интерфейса, поэтому криптография никогда не подвешивает UI.",
      ],
    },
  },
  {
    id: "serverless",
    icon: Network,
    title: { en: "Serverless P2P Architecture", ru: "Бессерверная P2P-архитектура" },
    summary: {
      en: "No accounts, no cloud, no database that belongs to us.",
      ru: "Нет аккаунтов, нет облака, нет нашей базы данных.",
    },
    body: {
      en: [
        "Trivo Chat Elite has no backend. There is no sign-up, no phone number, no e-mail, no session token and no server-side account record — because there is no server that could hold one. Your contacts, chats, folders, media blobs and delivery queue live in the device's own IndexedDB database (Dexie), and nothing is mirrored to a remote host.",
        "Historical builds of this app used cloud backends; those integrations have been fully removed from the codebase. There is no analytics SDK, no crash-reporting upload, no advertising identifier collection tied to your messages and no remote configuration channel. The synchronisation modules that remain are pure local queues that hand frames to the Tor transport.",
        "The practical consequence is simple: no one — including us — can hand over your message history, because no copy of it exists outside your handset. If you uninstall the app or use the panic wipe, that data is gone permanently. This is also why an encrypted local backup is the only way to move your identity to a new device.",
      ],
      ru: [
        "У Trivo Chat Elite нет бэкенда. Нет регистрации, номера телефона, e-mail, сессионного токена и серверной учётной записи — просто потому, что нет сервера, который мог бы её хранить. Контакты, чаты, папки, медиафайлы и очередь доставки находятся в собственной базе IndexedDB устройства (Dexie), и ничего не дублируется на удалённый хост.",
        "Ранние сборки приложения использовали облачные бэкенды; эти интеграции полностью удалены из кода. Нет SDK аналитики, нет отправки отчётов о сбоях, нет сбора рекламных идентификаторов, связанного с вашими сообщениями, и нет канала удалённой конфигурации. Оставшиеся модули синхронизации — это чисто локальные очереди, передающие кадры транспорту Tor.",
        "Практический вывод прост: никто, включая нас, не может выдать вашу переписку, потому что её копии не существует за пределами устройства. Если вы удалите приложение или используете экстренную очистку, эти данные исчезнут навсегда. Именно поэтому зашифрованная локальная резервная копия — единственный способ перенести личность на новое устройство.",
      ],
    },
  },
  {
    id: "routing",
    icon: RouteIcon,
    title: { en: "How Messages are Routed via Tor", ru: "Как сообщения маршрутизируются через Tor" },
    summary: {
      en: "Sealed frame → local queue → SOCKS5 → peer's onion service.",
      ru: "Запечатанный кадр → локальная очередь → SOCKS5 → onion-служба собеседника.",
    },
    body: {
      en: [
        "When you press send, the app builds a frame: a compact JSON envelope containing the message kind, your identifier, your current onion address, your public keys, a timestamp, the encrypted body and an Ed25519 signature. The frame is written into the local Dexie outbox first, so it survives an app kill, a reboot or a dead battery.",
        "Delivery is then attempted through the Tor SOCKS5 port to the recipient's .onion address, which was learned earlier through trust-on-first-use pinning. If the peer is reachable, the frame is streamed directly to their onion service, their device verifies the signature, decrypts the body and immediately acknowledges. If the peer is offline, the frame stays queued and the native foreground service retries it on a schedule, including while the interface is closed.",
        "Large media travels the same path but is split into numbered chunks. The receiver tracks which indices actually arrived and can ask for exactly the missing ones with a sync request, so a transfer interrupted by a lost circuit resumes instead of restarting. Nothing about this flow touches a relay server owned by anyone: your device and your contact's device are the only two endpoints that ever hold the plaintext.",
      ],
      ru: [
        "Когда вы нажимаете «отправить», приложение собирает кадр: компактный JSON-конверт с типом сообщения, вашим идентификатором, текущим onion-адресом, публичными ключами, отметкой времени, зашифрованным телом и подписью Ed25519. Сначала кадр записывается в локальную очередь Dexie, поэтому переживает закрытие приложения, перезагрузку или разряженную батарею.",
        "Затем выполняется попытка доставки через порт SOCKS5 сети Tor на .onion-адрес получателя, полученный ранее по принципу доверия при первом контакте с закреплением ключа. Если собеседник доступен, кадр передаётся напрямую его onion-службе, устройство проверяет подпись, расшифровывает тело и сразу подтверждает доставку. Если собеседник офлайн, кадр остаётся в очереди, а нативная foreground-служба повторяет попытки по расписанию, в том числе при закрытом интерфейсе.",
        "Крупные медиафайлы идут тем же путём, но разбиваются на нумерованные части. Получатель отслеживает, какие индексы действительно пришли, и может запросить ровно недостающие, поэтому прерванная передача продолжается, а не начинается заново. Ни один этап этого процесса не задействует чужой ретранслятор: открытый текст есть только на вашем устройстве и на устройстве собеседника.",
      ],
    },
  },
  {
    id: "background",
    icon: BellRing,
    title: { en: "Why the Background Service is Required", ru: "Зачем нужна фоновая служба" },
    summary: {
      en: "An onion service only receives messages while it is actually running.",
      ru: "Onion-служба принимает сообщения, только пока она действительно работает.",
    },
    body: {
      en: [
        "Trivo receives messages by hosting a server, not by polling one. Your handset is the endpoint of your own onion service, which means it must be listening at the moment a contact sends something. Android aggressively suspends normal processes, so the only supported way to keep that listener alive is a foreground service — and Android requires every foreground service to display a persistent notification.",
        "That is the notification titled \"P2P Tor Onion Network: Presence and Connectivity Check\". It does not send anything anywhere and it deliberately shows no onion address, no contact name and no message preview: it exists purely because the operating system demands a visible marker for a long-running service. Dismissing it is not possible while the transport is active; stopping the transport is done from inside the app.",
        "While the service runs, it keeps the Tor daemon bootstrapped, accepts inbound streams, buffers frames that arrive while the interface is closed, and retries anything sitting in the outbox. When you open the app again, those buffered frames are drained into the chat list instantly, which is why messages appear immediately rather than after a manual refresh.",
      ],
      ru: [
        "Trivo принимает сообщения, размещая сервер, а не опрашивая его. Ваше устройство — конечная точка собственной onion-службы, а значит, оно должно слушать в тот момент, когда контакт что-то отправляет. Android агрессивно усыпляет обычные процессы, поэтому единственный поддерживаемый способ сохранить слушателя живым — это foreground-служба, а для неё система требует постоянного уведомления.",
        "Это и есть уведомление «P2P Tor Onion Network: Presence and Connectivity Check». Оно ничего никуда не отправляет и намеренно не показывает onion-адрес, имя контакта или текст сообщения: оно существует лишь потому, что операционная система требует видимого маркера долгоживущей службы. Убрать его во время работы транспорта нельзя; остановить транспорт можно изнутри приложения.",
        "Пока служба работает, она поддерживает демон Tor в загруженном состоянии, принимает входящие потоки, буферизует кадры, пришедшие при закрытом интерфейсе, и повторяет отправку из очереди. При следующем открытии приложения буфер мгновенно выгружается в список чатов — поэтому сообщения появляются сразу, а не после ручного обновления.",
      ],
    },
  },
  {
    id: "battery",
    icon: BatteryCharging,
    title: { en: "Battery Consumption and Optimization", ru: "Расход батареи и оптимизация" },
    summary: {
      en: "Low-priority notification, idle circuits, worker-offloaded crypto.",
      ru: "Уведомление низкого приоритета, простаивающие цепочки, криптография в воркере.",
    },
    body: {
      en: [
        "A permanently running Tor daemon does cost energy, and we optimise for that instead of hiding it. The circuit is kept warm rather than rebuilt for every message, because rebuilding circuits is far more expensive than holding them. Presence checks use lightweight ping/pong frames on a fixed interval rather than a constant open stream, so the radio can return to a low-power state between checks.",
        "The notification channel is registered at low importance and the notification itself is silent, so it never wakes the screen or plays a sound. Retries for queued frames are scheduled, not busy-looped: when a peer is offline, the queue simply waits for the next attempt window instead of hammering the circuit.",
        "On the application side, NaCl encryption, signature verification and large JSON parsing run inside a dedicated Web Worker, and all database access goes through asynchronous IndexedDB transactions. Keeping heavy work off the interface thread avoids the CPU spikes that both drain the battery and produce the frame drops Android reports as ANRs. If you want maximum battery life, you can stop the transport from the app — you will simply receive messages only while the app is in the foreground.",
      ],
      ru: [
        "Постоянно работающий демон Tor действительно расходует энергию, и мы это оптимизируем, а не скрываем. Цепочка поддерживается «тёплой», а не пересобирается под каждое сообщение, потому что пересборка стоит намного дороже, чем удержание. Проверки присутствия используют лёгкие кадры ping/pong с фиксированным интервалом вместо постоянно открытого потока, поэтому радиомодуль между проверками возвращается в энергосберегающий режим.",
        "Канал уведомления зарегистрирован с низкой важностью, а само уведомление беззвучное, поэтому оно никогда не будит экран и не издаёт звук. Повторы отправки из очереди выполняются по расписанию, а не в холостом цикле: если собеседник офлайн, очередь просто ждёт следующего окна попытки.",
        "На стороне приложения шифрование NaCl, проверка подписей и разбор крупного JSON выполняются в отдельном Web Worker, а все обращения к базе идут через асинхронные транзакции IndexedDB. Вынос тяжёлой работы из потока интерфейса устраняет всплески нагрузки на процессор, которые и сажают батарею, и вызывают пропуски кадров, фиксируемые Android как ANR. Если нужна максимальная автономность, транспорт можно остановить в приложении — тогда сообщения будут приходить только при открытом приложении.",
      ],
    },
  },
  {
    id: "identity",
    icon: Fingerprint,
    title: { en: "Anonymity and Identity Verification", ru: "Анонимность и проверка личности" },
    summary: {
      en: "Key fingerprints, trust-on-first-use pinning, no personal data.",
      ru: "Отпечатки ключей, закрепление при первом контакте, никаких персональных данных.",
    },
    body: {
      en: [
        "You are never asked for a phone number, an e-mail address or a real name. Your identity is your key pair, and the identifier other people see is derived from your public signing key by hashing it and formatting the result as a short fingerprint. Two people add each other by exchanging that fingerprint and onion address, typically through a QR code, which keeps the exchange offline and out of band.",
        "Trivo uses trust-on-first-use pinning. The first time a contact's frame arrives, its signing key is stored against that contact. Every later frame must be signed by exactly the same key: if it is not, the frame is rejected and a mismatch warning is logged rather than silently accepted. That is what makes an impersonation attempt visible instead of invisible.",
        "You can confirm a contact out of band by comparing the fingerprint shown in their profile with the one they read to you over a channel you already trust. Because the fingerprint is a hash of the public key, matching fingerprints means matching keys, and matching keys mean the encryption is terminating on the device you think it is — not on an intermediary.",
      ],
      ru: [
        "У вас никогда не запрашивают номер телефона, адрес e-mail или настоящее имя. Ваша личность — это пара ключей, а идентификатор, который видят другие, вычисляется из публичного ключа подписи путём хеширования и форматирования в короткий отпечаток. Люди добавляют друг друга, обмениваясь этим отпечатком и onion-адресом, обычно через QR-код, что делает обмен офлайновым и внеполосным.",
        "Trivo использует закрепление ключа при первом контакте. Когда кадр контакта приходит впервые, его ключ подписи сохраняется за этим контактом. Любой последующий кадр должен быть подписан ровно тем же ключом: если нет, кадр отклоняется, а несовпадение фиксируется предупреждением, а не принимается молча. Именно это делает попытку подмены заметной.",
        "Контакт можно подтвердить внеполосно, сравнив отпечаток в его профиле с тем, который он назовёт вам по уже доверенному каналу. Поскольку отпечаток — это хеш публичного ключа, совпадение отпечатков означает совпадение ключей, а совпадение ключей означает, что шифрование заканчивается именно на том устройстве, на котором вы думаете, а не на посреднике.",
      ],
    },
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
