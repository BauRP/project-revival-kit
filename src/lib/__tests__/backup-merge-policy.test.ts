import { describe, expect, it } from "vitest";
import { lifecycleRowsForRestore, isIrreversiblePrivacyMarker, lifecycleRowsToPurgeForDeletedMessages } from "../backup-merge-policy";

const removed = {
  key:'["deleted-message","a"]', chatKey:"deleted-message-local",
  messageId:"a", data:{deleted:true},
};
const consumed = {
  key:"consumed-media::file", chatKey:"consumed-media",
  messageId:"file", data:{consumed:true},
};
const ordinary = {
  key:"reaction::peer::a",chatKey:"reaction::peer",
  messageId:"a",data:{emoji:"✅"},
};

describe("monotonic merge of portable backups", () => {
  it("applies restored deletions even if local DB has same lifecycle key", () => {
    expect(lifecycleRowsForRestore([removed,consumed],new Set([removed.key,consumed.key])))
      .toEqual([removed,consumed]);
  });
  it("does not overwrite newer device-specific mutable state", () => {
    expect(lifecycleRowsForRestore([ordinary],new Set([ordinary.key]))).toEqual([]);
    expect(lifecycleRowsForRestore([ordinary],new Set())).toEqual([ordinary]);
  });
  it("never treats a forged key or unconfirmed flag as an irreversible marker", () => {
    expect(isIrreversiblePrivacyMarker({...consumed,key:"other"})).toBe(false);
    expect(isIrreversiblePrivacyMarker({...consumed,data:{consumed:false}})).toBe(false);
    expect(isIrreversiblePrivacyMarker({...removed,messageId:"other"})).toBe(false);
    expect(isIrreversiblePrivacyMarker(ordinary)).toBe(false);
  });
});

describe("restore deletion erases stale mutable lifecycle state", () => {
  it("removes backed-up edits, reactions but keeps the irreversible tombstone", () => {
    const edited = {
      key:"peer::a",chatKey:"peer",messageId:"a",
      data:{editedText:"previous secret"},
    };
    const reaction = {...ordinary, key:"reaction::peer::a",data:{emoji:"👍",outboundEventId:"ev"}};
    const other = {...ordinary,key:"reaction::peer::b",messageId:"b"};
    const rows=[removed,edited,reaction,other];
    const stale = lifecycleRowsToPurgeForDeletedMessages(rows,new Set(["a"]));
    expect(stale).toEqual([edited,reaction]);
    expect(stale).not.toContain(removed);
    expect(stale).not.toContain(other);
  });
  it("retains consumed markers and unrelated messages", () => {
    const sameConsumed={...consumed,messageId:"a"};
    expect(lifecycleRowsToPurgeForDeletedMessages([sameConsumed,ordinary],new Set(["a"])))
      .toEqual([ordinary]);
    expect(lifecycleRowsToPurgeForDeletedMessages([ordinary],new Set())).toEqual([]);
  });
});
