// Local mapping: which custom folders a chat belongs to.
// Key: folderId → array of chatIds. The "ВСЕ" system folder is implicit
// (every chat is shown there) and is never written to this map.
import { dbGet, dbPut } from "@/lib/storage";

const KEY = "folder-assignments-v1";

export type FolderAssignments = Record<string, string[]>;

const cache: { data: FolderAssignments | null } = { data: null };
const listeners = new Set<() => void>();

async function ensureLoaded(): Promise<FolderAssignments> {
  if (cache.data) return cache.data;
  cache.data = (await dbGet<FolderAssignments>("settings", KEY)) || {};
  return cache.data;
}

export async function getAssignments(): Promise<FolderAssignments> {
  return ensureLoaded();
}

export async function getFoldersForChat(chatId: string): Promise<string[]> {
  const data = await ensureLoaded();
  return Object.keys(data).filter((fid) => data[fid]?.includes(chatId));
}

export async function getChatsInFolder(folderId: string): Promise<string[]> {
  const data = await ensureLoaded();
  return data[folderId] ? [...data[folderId]] : [];
}

export async function setChatFolders(chatId: string, folderIds: string[]): Promise<void> {
  const data = await ensureLoaded();
  // Remove chat from every folder, then add to selected ones.
  for (const fid of Object.keys(data)) {
    data[fid] = (data[fid] || []).filter((id) => id !== chatId);
  }
  for (const fid of folderIds) {
    if (!data[fid]) data[fid] = [];
    if (!data[fid].includes(chatId)) data[fid].push(chatId);
  }
  await dbPut("settings", KEY, data);
  listeners.forEach((cb) => cb());
}

export function onAssignmentsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
