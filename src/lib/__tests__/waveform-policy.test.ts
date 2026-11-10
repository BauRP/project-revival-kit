import { describe, expect, it } from "vitest";
import { canReadWaveformLocally, readBoundedWaveformBytes } from "../waveform-policy";

describe("private audio waveform memory and network policy", () => {
  const origin = "https://localhost";
  it("permits same-origin local assets and local blob URLs but never third-party URLs", () => {
    expect(canReadWaveformLocally("./audio.m4a", origin)).toBe(true);
    expect(canReadWaveformLocally("blob:https://localhost/abc", origin)).toBe(true);
    expect(canReadWaveformLocally("https://localhost/a.mp3", origin)).toBe(true);
    expect(canReadWaveformLocally("https://attacker.example/voice", origin)).toBe(false);
    expect(canReadWaveformLocally("blob:https://attacker.example/abc", origin)).toBe(false);
    expect(canReadWaveformLocally("javascript:alert(1)", origin)).toBe(false);
  });
  it("reads small audio streams without using unbounded arrayBuffer", async () => {
    const response = new Response(Uint8Array.of(1, 2, 3));
    expect(Array.from(new Uint8Array((await readBoundedWaveformBytes(response, 4))!)))
      .toEqual([1,2,3]);
  });
  it("rejects declared and streamed audio larger than the budget", async () => {
    const declared = new Response("longer", {headers:{"content-length":"99999"}});
    expect(await readBoundedWaveformBytes(declared, 5)).toBeNull();
    const streamed = new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.of(1,2,3));controller.enqueue(Uint8Array.of(4,5,6));controller.close(); },
    }));
    expect(await readBoundedWaveformBytes(streamed, 5)).toBeNull();
  });
  it("falls back safely for empty, failed, and unreadable responses", async () => {
    expect(await readBoundedWaveformBytes(new Response(null), 16)).toBeNull();
    expect(await readBoundedWaveformBytes(new Response("blocked", {status:403}),16)).toBeNull();
    expect(await readBoundedWaveformBytes(new Response("ok"),0)).toBeNull();
  });
});
