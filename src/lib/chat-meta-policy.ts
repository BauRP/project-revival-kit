/** Deterministic merge for peer chat summaries, safe for CAS retries. */
import type { ChatMeta } from "./p2p";

export interface IncomingChatSummary {
  friendId: string;
  messageId: string;
  text: string;
  timestamp: number;
}

export function mergeIncomingChatSummary(
  previous: ChatMeta | undefined, input: IncomingChatSummary,
): ChatMeta {
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0)
    throw new Error("Invalid incoming summary timestamp");
  if (typeof input.messageId !== "string" || input.messageId.length < 1 ||
      input.messageId.length > 256)
    throw new Error("Invalid incoming summary message ID");
  const newest = !previous || input.timestamp >= previous.lastMessageTime;
  const repeated = previous?.lastMessageId === input.messageId;
  return {
    friendId: input.friendId,
    friendName: previous?.friendName || input.friendId.slice(0, 8),
    friendAvatar: previous?.friendAvatar,
    lastMessage: newest ? input.text : previous!.lastMessage,
    lastMessageTime: newest ? input.timestamp : previous!.lastMessageTime,
    lastMessageId: newest ? input.messageId : previous?.lastMessageId,
    unread: repeated ? previous!.unread : Math.min(
      Number.MAX_SAFE_INTEGER, (previous?.unread ?? 0) + 1,
    ),
    started: true,
  };
}
