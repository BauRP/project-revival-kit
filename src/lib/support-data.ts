export type SupportIntent = {
  id: string;
  keywords: string[];
  replyRu: string;
  replyEn: string;
};

export const botKnowledgeBase: SupportIntent[] = [
  
  // ==========================================
  // СИСТЕМНЫЕ КОМАНДЫ (В стиле Telegram)
  // ==========================================
  {
    id: "cmd_help",
    keywords: ["/help", "/start", "помощь", "меню", "что ты умеешь", "команды", "help"],
    replyRu: "🛠 **Главное меню Trivo Support**\n\nЯ помогу вам разобраться в приложении. Вот что у меня часто спрашивают:\n• Как добавить друга?\n• Почему нет связи? (Сеть Tor)\n• Как включить пароль/биометрию?\n• Где найти исчезающие сообщения?\n\nПросто напишите свой вопрос обычным текстом!",
    replyEn: "🛠 **Trivo Support Main Menu**\n\nI can help you navigate the app. Common questions:\n• How to add a friend?\n• Why is there no connection? (Tor Network)\n• How to enable password/biometrics?\n• Where are disappearing messages?\n\nJust type your question normally!"
  },
  {
    id: "cmd_status",
    keywords: ["/status", "/tor", "сеть", "статус", "не грузит", "долго подключается", "подключение", "connection", "loading"],
    replyRu: "🌐 **О сети Tor и P2P**\n\nTrivo Chat Elite — это децентрализованный мессенджер. \nВ отличие от обычных приложений, мы не используем сервера. Ваше устройство напрямую связывается с друзьями через защищенную сеть Tor.\n\n⚠️ *Первичное подключение или поиск узлов может занять от 10 до 30 секунд. Это нормальная цена за абсолютную анонимность. Проверить статус узлов можно во вкладке «БЕЗОПАСНОСТЬ».*",
    replyEn: "🌐 **About Tor & P2P Network**\n\nTrivo Chat Elite is decentralized. We don't use servers. Your device connects directly to friends via the secure Tor network.\n\n⚠️ *Initial connection or finding nodes can take 10-30 seconds. This is the normal price for absolute anonymity. You can check node status in the 'SECURITY' tab.*"
  },

  // ==========================================
  // НАВИГАЦИЯ ПО ИНТЕРФЕЙСУ (Скриншоты + Детали)
  // ==========================================
  {
    id: "chat_three_dots",
    keywords: ["три точки в чате", "меню чата", "настройки чата", "очистить историю", "удалить переписку", "таймер", "исчезающ"],
    replyRu: "⚙️ **Меню Чата (Три точки сверху справа):**\n\n1. **Таймер сообщений:** Включите самоуничтожение (от 1 часа до 24 часов).\n2. **Очистить историю:** Удаляет сообщения только на вашем устройстве.\n3. **Удалить чат:** Полностью стирает переписку и закрывает P2P канал.",
    replyEn: "⚙️ **Chat Menu (Three dots top right):**\n\n1. **Message Timer:** Enable self-destruction (1h to 24h).\n2. **Clear History:** Deletes messages locally on your device.\n3. **Delete Chat:** Completely wipes the chat and closes the P2P channel."
  },
  {
    id: "friends_three_dots",
    keywords: ["три точки в друзьях", "удалить друга", "заблокировать", "меню контакта", "черный список"],
    replyRu: "👥 **Управление контактами (Вкладка «ДРУЗЬЯ»):**\n\nНажав на три точки рядом с именем друга, вы можете:\n• Открыть его профиль.\n• Удалить из списка контактов.\n• Заблокировать (он больше не сможет отправить вам запрос через P2P).",
    replyEn: "👥 **Contact Management ('FRIENDS' tab):**\n\nTapping the three dots next to a friend lets you:\n• Open their profile.\n• Remove them from contacts.\n• Block them (they won't be able to send P2P requests)."
  },
  {
    id: "add_friend_process",
    keywords: ["/friends", "как добавить", "найти друг", "добавить контакт", "add friend", "добавление"],
    replyRu: "➕ **Как добавить собеседника:**\n\n1. Откройте вкладку «ДОБАВИТЬ ДРУЗЬЯ» (снизу).\n2. Вставьте туда уникальный ID вашего друга (например, 4A2D...).\n3. Нажмите добавить. \n*Важно: Ваш друг должен быть онлайн (с запущенным приложением), чтобы P2P-рукопожатие прошло успешно!*",
    replyEn: "➕ **How to add someone:**\n\n1. Open the 'ADD FRIENDS' tab (bottom).\n2. Paste your friend's unique ID (e.g., 4A2D...).\n3. Press add. \n*Important: Your friend must be online (app open) for the P2P handshake to succeed!*"
  },
  {
    id: "security_tab_info",
    keywords: ["/security", "раздел безопасность", "вкладка безопасность", "что в безопасности", "статус шифрования", "ключи"],
    replyRu: "🛡 **Вкладка «БЕЗОПАСНОСТЬ»:**\n\nЭто ваш пульт управления паранойей. Здесь отображаются:\n• Статус подключения к P2P сети.\n• Маршруты Tor-узлов.\n• Логи генерации криптографических ключей Ed25519.\n*Если там горит зеленая иконка — вы полностью защищены.*",
    replyEn: "🛡 **'SECURITY' Tab:**\n\nThis is your paranoia control center. It shows:\n• P2P connection status.\n• Tor node routing.\n• Ed25519 cryptographic key generation logs.\n*If you see a green icon there, you are fully secured.*"
  },
  {
    id: "profile_and_status",
    keywords: ["раздел профиль", "как поменять статус", "где статус", "мой айди", "скопировать id", "в сети", "занят"],
    replyRu: "👤 **Вкладка «ПРОФИЛЬ»:**\n\nЗдесь находится ваш ID. Нажмите кнопку рядом с ним, чтобы скопировать и отправить другу. Также ниже вы можете изменить свой сетевой статус («В сети», «Отошел», «Не беспокоить»).",
    replyEn: "👤 **'PROFILE' Tab:**\n\nHere is your ID. Tap the button next to it to copy and share with a friend. Below, you can change your network status ('Online', 'Away', 'Do Not Disturb')."
  },
  {
    id: "all_settings_gear",
    keywords: ["шестеренка", "настройки приложения", "где поменять язык", "тема", "светлая", "темная", "уведомления", "settings"],
    replyRu: "⚙️ **Глобальные настройки (Шестеренка в Профиле):**\n\n• **Оформление:** Светлая или Темная тема.\n• **Язык:** Выбор из 15 языков перевода.\n• **Безопасность:** Включение пароля и биометрии (Отпечаток/FaceID) на вход в приложение.\n• **Данные:** Управление локальным хранилищем.",
    replyEn: "⚙️ **Global Settings (Gear in Profile):**\n\n• **Appearance:** Light or Dark theme.\n• **Language:** Choose from 15 languages.\n• **Security:** Enable App Lock password or biometrics (Fingerprint/FaceID).\n• **Data:** Manage local storage."
  },

  // ==========================================
  // КОНКУРЕНТЫ И УНИКАЛЬНОСТЬ (Signal, Telegram, WhatsApp)
  // ==========================================
  {
    id: "lost_account_recovery",
    keywords: ["забыл пароль", "потерял телефон", "восстановить аккаунт", "вернуть доступ", "удалил приложение", "recovery", "восстановление"],
    replyRu: "🚨 **Восстановление аккаунта невозможно!**\n\nTrivo Chat Elite — это мессенджер нулевого доверия. У нас нет серверов баз данных. Ваш аккаунт существует ТОЛЬКО на вашем устройстве.\n\n*Если вы удалите приложение или потеряете телефон, ваш ID и переписки сгорят навсегда. Создайте новый аккаунт.*",
    replyEn: "🚨 **Account recovery is impossible!**\n\nTrivo Chat Elite is a zero-trust messenger. We have no databases. Your account exists ONLY on your device.\n\n*If you delete the app or lose your phone, your ID and chats are gone forever. You must create a new account.*"
  },
  {
    id: "competitor_comparison",
    keywords: ["чем лучше", "почему вы", "отличие от telegram", "telegram", "whatsapp", "signal", "отличия", "разница", "лучше"],
    replyRu: "👑 **Чем мы лучше Telegram и WhatsApp?**\n\n1. **Нет номеров:** Мы не требуем SIM-карту.\n2. **Нет серверов:** В Telegram ваши данные лежат на их серверах. У нас серверов нет вообще (чистый P2P).\n3. **Невозможно заблокировать:** Благодаря Tor Hidden Services, правительство или провайдер не смогут заблокировать ваш чат.",
    replyEn: "👑 **How are we better than Telegram/WhatsApp?**\n\n1. **No phone numbers:** We don't require a SIM.\n2. **No servers:** Telegram stores data on their servers. We have no servers (pure P2P).\n3. **Unblockable:** Thanks to Tor Hidden Services, governments or ISPs cannot block your chats."
  },

  // ==========================================
  // НОВЫЕ ТЕХНИЧЕСКИЕ ВОПРОСЫ (Галочки, Батарея, Файлы)
  // ==========================================
  {
    id: "message_status_ticks",
    keywords: ["галочки", "одна галочка", "две галочки", "прочитано", "доставлено", "статус сообщения", "ticks", "read receipt"],
    replyRu: "✔️ **Что значат галочки?**\n\n• **Одна серая галочка:** Сообщение зашифровано и отправлено в сеть Tor.\n• **Две серые галочки:** Устройство друга получило пакет (он в сети).\n• **Две синие галочки:** Друг открыл чат и прочитал сообщение.",
    replyEn: "✔️ **What do the ticks mean?**\n\n• **One grey tick:** Encrypted and sent into the Tor network.\n• **Two grey ticks:** Friend's device received it (they are online).\n• **Two blue ticks:** Friend opened the chat and read it."
  },
  {
    id: "battery_drain",
    keywords: ["садится батарея", "жрет заряд", "аккумулятор", "оптимизация", "фоновый режим", "battery"],
    replyRu: "🔋 **Оптимизация батареи:**\n\nПоддержание прямого P2P-узла и маршрутизация Tor требуют больше энергии, чем обычные мессенджеры. \n\n*Совет:* Чтобы сообщения приходили стабильно, отключите экономию заряда для Trivo Chat Elite в настройках вашего Android.",
    replyEn: "🔋 **Battery Optimization:**\n\nMaintaining a direct P2P node and Tor routing requires more power than standard apps.\n\n*Tip:* For stable message delivery, disable battery optimization for Trivo Chat Elite in your Android settings."
  },
  {
    id: "media_sending",
    keywords: ["как отправить фото", "видео", "лимит", "файл", "картинка", "голосовое", "media", "send photo"],
    replyRu: "📎 **Отправка файлов:**\n\nВы можете безопасно передавать фото, короткие видео и аудиосообщения (с ИИ-транскрипцией). Поскольку передача идет напрямую (P2P), скорость зависит от интернета обоих собеседников.\n\n*Ограничение: Большие видео могут загружаться дольше из-за множественной Tor-маршрутизации.*",
    replyEn: "📎 **Sending Files:**\n\nYou can securely send photos, short videos, and audio (with AI transcription). Since it's direct P2P, speed depends on both users' internet.\n\n*Note: Large videos may take longer due to multiple Tor routing hops.*"
  }
];