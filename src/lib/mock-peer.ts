// Mock test peer for first-launch initialization
import { dbGet, dbPut } from "./storage";
import { saveLocalMessage, type ChatMeta, type P2PMessage } from "./p2p";

const MOCK_PEER_ID = "TRIVO_MOCK_PEER_999";
const MOCK_INIT_KEY = "mock-peer-initialized";

interface MockPeerConfig {
  id: string;
  names: Record<string, string>;
}

/**
 * Canonical, language-independent display title of the built-in system bot.
 * Rendered identically in the chat list and inside the active chat header.
 */
export const SUPPORT_BOT_NAME = "Trivo Support (Bot)";

const MOCK_PEER: MockPeerConfig = {
  id: MOCK_PEER_ID,
  names: {
    en: SUPPORT_BOT_NAME,
    ru: SUPPORT_BOT_NAME,
    kk: SUPPORT_BOT_NAME,
  },
};

export function getMockPeerName(_lang?: string): string {
  return SUPPORT_BOT_NAME;
}

/**
 * One-shot rename migration for installs created before the bot was renamed.
 * Keeps the stored contact record in sync with SUPPORT_BOT_NAME.
 */
export async function ensureSupportBotName(): Promise<void> {
  try {
    const contact = await dbGet<ChatMeta>("contacts", MOCK_PEER_ID);
    if (contact && contact.friendName !== SUPPORT_BOT_NAME) {
      await dbPut("contacts", MOCK_PEER_ID, { ...contact, friendName: SUPPORT_BOT_NAME });
    }
  } catch {
    /* renaming is best effort; the UI still overrides the title at render time */
  }
}

export async function initMockPeer(language: string): Promise<boolean> {
  const alreadyInit = await dbGet<boolean>("settings", MOCK_INIT_KEY);
  if (alreadyInit) {
    await ensureSupportBotName();
    return false;
  }

  const name = getMockPeerName(language);

  // Add to contacts
  await dbPut("contacts", MOCK_PEER_ID, {
    friendId: MOCK_PEER_ID,
    friendName: name,
    friendAvatar: null,
    lastMessage:
      language === "ru"
        ? "Добро пожаловать в Trivo! 🎉"
        : language === "kk"
          ? "Trivo-ға қош келдіңіз! 🎉"
          : "Welcome to Trivo! 🎉",
    lastMessageTime: Date.now(),
    unread: 1,
    started: true,
  } as ChatMeta);

  // Add a welcome message
  const welcomeMsg = {
    id: `mock-welcome-${Date.now()}`,
    from: MOCK_PEER_ID,
    to: "self",
    text:
      language === "ru"
        ? "Привет! Я бот поддержки Trivo. Это тестовый чат, чтобы вы могли изучить приложение. Все ваши сообщения зашифрованы сквозным шифрованием. 🔐"
        : language === "kk"
          ? "Сәлем! Мен Trivo қолдау ботымын. Бұл сынақ чат, қолданбаны зерттеуге арналған. Барлық хабарламаларыңыз сквозды шифрланған. 🔐"
          : "Hi! I'm the Trivo support bot. This is a test chat so you can explore the app. All your messages are end-to-end encrypted. 🔐",
    timestamp: Date.now(),
    status: "delivered",
  };
  await saveLocalMessage(welcomeMsg as P2PMessage);

  await dbPut("settings", MOCK_INIT_KEY, true);
  return true;
}

/**
 * Trivo Support is the built-in test contact. NO media restrictions —
 * users may send any file (image, audio, music, document) to verify the
 * full media-delivery pipeline (uploadMedia → local blob store → P2P).
 * Returns true for any media type. Used as the canonical "is this peer the
 * test bot?" check.
 */
export function isTrivoSupport(peerId: string): boolean {
  return peerId === MOCK_PEER_ID;
}

export function trivoSupportAcceptsMedia(_mime: string): true {
  return true;
}

export { MOCK_PEER_ID };
