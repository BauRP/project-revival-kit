import { describe, expect, it } from "vitest";
import { advanceDeliveryStatus, shouldEmitDeliveryEvent, shouldNotifyMessageAcknowledgement, shouldAcceptTextMessageAck, sameOutboxFrameForResult, type DeliveryStatus } from "../delivery-status-policy";

describe("monotonic authenticated Tor delivery status", () => {
  const states: DeliveryStatus[] = ["pending","sent","delivered","read"];
  it("never moves an acknowledged or read message backwards", () => {
    for (const current of states) for (const incoming of states) {
      const result = advanceDeliveryStatus(current, incoming);
      expect(states.indexOf(result)).toBe(Math.max(
        states.indexOf(current), states.indexOf(incoming),
      ));
    }
  });
  it("distinguishes socket acceptance from durable recipient ACK", () => {
    expect(advanceDeliveryStatus("pending","sent")).toBe("sent");
    expect(advanceDeliveryStatus("delivered","sent")).toBe("delivered");
    expect(advanceDeliveryStatus("read","delivered")).toBe("read");
    expect(advanceDeliveryStatus("sent","delivered")).toBe("delivered");
  });
});

describe("Tor UI events can never regress after a remote ACK", () => {
  it("allows sent then delivered, but not delivered then a late sent", () => {
    expect(shouldEmitDeliveryEvent(undefined, "sent")).toBe(true);
    expect(shouldEmitDeliveryEvent("sent", "delivered")).toBe(true);
    expect(shouldEmitDeliveryEvent("delivered", "sent")).toBe(false);
    expect(shouldEmitDeliveryEvent("delivered", "delivered")).toBe(false);
    expect(shouldEmitDeliveryEvent("sent", "sent")).toBe(false);
    expect(shouldEmitDeliveryEvent(undefined, "delivered")).toBe(true);
  });
});

describe("durable ACK UI delivery type isolation", () => {
  it("does not mark a chat message delivered for non-message event ACKs", () => {
    for (const kind of [
      "profile_update", "message_reaction", "message_lifecycle",
      "history_protection", "friend_request", "message_status",
    ]) {
      expect(shouldNotifyMessageAcknowledgement(kind, true)).toBe(false);
    }
  });
  it("ignores an ACK after the original chat message was deleted", () => {
    expect(shouldNotifyMessageAcknowledgement("text_message", false)).toBe(false);
    expect(shouldNotifyMessageAcknowledgement("text_message", true)).toBe(true);
  });
});

describe("stale Tor socket results and authenticated delivery route", () => {
  const sent = { id: "frame", peer: "peer-a", kind: "text_message",
    frame: "encrypted-frame-a", createdAt: 10 };
  it("only changes the exact original outbox frame after network I/O", () => {
    expect(sameOutboxFrameForResult({...sent},sent)).toBe(true);
    expect(sameOutboxFrameForResult({...sent,peer:"peer-b"},sent)).toBe(false);
    expect(sameOutboxFrameForResult({...sent,frame:"replaced-frame"},sent)).toBe(false);
    expect(sameOutboxFrameForResult({...sent,createdAt:11},sent)).toBe(false);
    expect(sameOutboxFrameForResult({...sent,kind:"message_reaction"},sent)).toBe(false);
  });
  it("only advances delivery for a message addressed to the ACK sender", () => {
    expect(shouldAcceptTextMessageAck({to:"peer-a"},"peer-a")).toBe(true);
    expect(shouldAcceptTextMessageAck({to:"peer-b"},"peer-a")).toBe(false);
  });
});
