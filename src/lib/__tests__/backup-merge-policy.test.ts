import { describe, expect, it } from "vitest";
import { lifecycleRowsForRestore, isIrreversiblePrivacyMarker } from "../backup-merge-policy";

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
