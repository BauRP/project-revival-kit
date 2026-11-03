import { describe, expect, it } from "vitest";
import { makePortableBackupPackage, readPortableBackupPayload, assertMatchingBackupIdentity } from "../backup-package";
import type { IdentityKeys } from "../crypto";

const dump = () => ({
  schemaVersion: 3 as const, createdAt: 1000, contacts: [], messages: [],
  outbox: [], lifecycle: [], blobs: [],
});
const identity: IdentityKeys = {
  createdAt: 1000,
  signing: { publicKey: "signing-key", secretKey: "secret" },
  exchange: { publicKey: "exchange-key", secretKey: "secret" },
};
describe("portable recovery package", () => {
  it("carries both history and the identity in the encrypted payload", () => {
    const p = makePortableBackupPackage(identity, dump());
    expect(p.format).toBe("TRIVO-PORTABLE-PACKAGE-V1");
    const unpacked = readPortableBackupPayload(JSON.parse(JSON.stringify(p)));
    expect(unpacked.identity).toEqual(identity);
    expect(unpacked.dump).toEqual(dump());
  });
  it("imports old database-only archives without fabricating an identity", () => {
    const result = readPortableBackupPayload(dump());
    expect(result.identity).toBeNull();
  });
  it("rejects malicious or missing package content before the write transaction", () => {
    expect(() => readPortableBackupPayload({ format: "TRIVO-PORTABLE-PACKAGE-V1", database: dump() })).toThrow();
    expect(() => readPortableBackupPayload({ format: "TRIVO-PORTABLE-PACKAGE-V1", identity, database: {} })).toThrow();
  });
  it("does not mix backup conversations into another onion identity", () => {
    expect(() => assertMatchingBackupIdentity("alice", "bob")).toThrow(/different Trivo identity/);
    expect(() => assertMatchingBackupIdentity("alice", "alice")).not.toThrow();
  });
});
