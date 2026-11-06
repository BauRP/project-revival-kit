import { describe, expect, it } from "vitest";
import { advanceDeliveryStatus, type DeliveryStatus } from "../delivery-status-policy";

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
