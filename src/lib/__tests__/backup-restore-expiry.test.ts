import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  readFile: vi.fn(), decrypt: vi.fn(), currentIdentity: vi.fn(),
  validateIdentity: vi.fn((x: unknown) => x),
  readPayload: vi.fn(), assertMatching: vi.fn(),
  importDump: vi.fn(), transfer: vi.fn(), purgeExpired: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { readFile: calls.readFile },
  Directory: { Documents: "DOCUMENTS" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("../platform", () => ({ isNative: () => true }));
vi.mock("../dexie-db", () => ({
  importDexieDump: calls.importDump,
}));
vi.mock("../crypto", () => ({
  getOrCreateIdentity: calls.currentIdentity,
  validateIdentityKeys: calls.validateIdentity,
}));
vi.mock("../backup-crypto", () => ({ decryptBackupV2: calls.decrypt }));
vi.mock("../identity-transfer", () => ({
  restoreIdentityOnFreshDevice: calls.transfer,
}));
vi.mock("../p2p", () => ({ purgeExpiredLocalMessages: calls.purgeExpired }));
vi.mock("../backup-package", () => ({
  readPortableBackupPayload: calls.readPayload,
  assertMatchingBackupIdentity: calls.assertMatching,
}));

import { importBackup } from "../backup";

const database = {
  schemaVersion: 3, createdAt: 1000,
  contacts: [], messages: [], outbox: [], lifecycle: [], blobs: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  calls.readFile.mockResolvedValue({ data: JSON.stringify({ magic: "TRIVO-BACKUP-V2" }) });
  calls.decrypt.mockResolvedValue("{}");
  calls.currentIdentity.mockResolvedValue({ id: "current" });
  calls.readPayload.mockReturnValue({ dump: database, identity: { id: "recovered" } });
  calls.assertMatching.mockImplementation(() => { throw new Error("Different identity"); });
  calls.importDump.mockResolvedValue(undefined);
  calls.transfer.mockResolvedValue(undefined);
  calls.purgeExpired.mockResolvedValue(undefined);
});

describe("encrypted backup identity restore and disappearing-message privacy", () => {
  it("purges already-expired messages after a successful fresh-device identity transfer", async () => {
    await expect(importBackup("password", "TrivoBackup.tvc", {
      allowEmptyDeviceIdentityTransfer: true,
    })).resolves.toEqual({ identityChanged: true });
    expect(calls.transfer).toHaveBeenCalledExactlyOnceWith({ id: "recovered" }, database);
    expect(calls.importDump).not.toHaveBeenCalled();
    expect(calls.purgeExpired).toHaveBeenCalledOnce();
    expect(calls.transfer.mock.invocationCallOrder[0])
      .toBeLessThan(calls.purgeExpired.mock.invocationCallOrder[0]);
  });

  it("continues to purge after ordinary same-identity restore", async () => {
    calls.assertMatching.mockImplementation(() => undefined);
    await expect(importBackup("password", "TrivoBackup.tvc"))
      .resolves.toEqual({ identityChanged: false });
    expect(calls.importDump).toHaveBeenCalledExactlyOnceWith(database);
    expect(calls.transfer).not.toHaveBeenCalled();
    expect(calls.purgeExpired).toHaveBeenCalledOnce();
    expect(calls.importDump.mock.invocationCallOrder[0])
      .toBeLessThan(calls.purgeExpired.mock.invocationCallOrder[0]);
  });

  it("refuses a foreign identity without explicit transfer authorization", async () => {
    await expect(importBackup("password", "TrivoBackup.tvc"))
      .rejects.toThrow("Different identity");
    expect(calls.transfer).not.toHaveBeenCalled();
    expect(calls.importDump).not.toHaveBeenCalled();
    expect(calls.purgeExpired).not.toHaveBeenCalled();
  });

  it("does not start cleanup if fresh-device transfer failed", async () => {
    calls.transfer.mockRejectedValueOnce(new Error("Recovery transaction aborted"));
    await expect(importBackup("password", "TrivoBackup.tvc", {
      allowEmptyDeviceIdentityTransfer: true,
    })).rejects.toThrow("Recovery transaction aborted");
    expect(calls.purgeExpired).not.toHaveBeenCalled();
  });

  it("reports a cleanup failure without rolling back an already committed identity", async () => {
    calls.purgeExpired.mockRejectedValueOnce(new Error("Cannot clean expired messages"));
    await expect(importBackup("password", "TrivoBackup.tvc", {
      allowEmptyDeviceIdentityTransfer: true,
    })).rejects.toThrow("Cannot clean expired messages");
    expect(calls.transfer).toHaveBeenCalledOnce();
    expect(calls.importDump).not.toHaveBeenCalled();
  });
});
