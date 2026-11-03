import { describe, expect, it } from "vitest";
import { stripSessionMediaUrl } from "../backup-media-policy";
import { validateBackupStructure } from "../backup-validation";
import type { StoredMessage } from "../dexie-db";

const message: StoredMessage = {
  id: "id", from: "from", to: "to", text: "",
  timestamp: 1000, status: "delivered",
  media: {
    id: "a", fileId: "file-a", type: "image", name: "photo.png",
    size: 2, mimeType: "image/png",
    url: "https://tracker.example/secret.jpg",
  },
};
describe("portable media references", () => {
  it("removes ephemeral and remote URLs without changing the original message", () => {
    const scrubbed = stripSessionMediaUrl(message);
    expect((scrubbed.media as {url:string}).url).toBe("");
    expect((message.media as {url:string}).url).toContain("https://");
    expect((scrubbed.media as {fileId:string}).fileId).toBe("file-a");
  });
  it("rejects malformed nested media before restoration", () => {
    const dump = {
      schemaVersion: 3, createdAt: 1000,
      contacts: [], messages: [{ ...message, media: { type: "image", fileId: "bad" } }],
      outbox: [], lifecycle: [], blobs: [],
    };
    expect(() => validateBackupStructure(dump)).toThrow("Invalid backup message attachment");
  });
  it("accepts valid local media and their cleared URLs", () => {
    expect(() => validateBackupStructure({
      schemaVersion: 3, createdAt: 1000, contacts: [],
      messages: [stripSessionMediaUrl(message)],
      outbox: [], lifecycle: [], blobs: [],
    })).not.toThrow();
  });
});
