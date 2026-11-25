import { afterEach, describe, expect, it, vi } from "vitest";
import { pickBackupFileAsText } from "../backup-file-picker";
import { MAX_BACKUP_FILE_BYTES } from "../backup-input-policy";

class FakePicker extends EventTarget {
  type = "";
  accept = "";
  files: FileList | null = null;
  clicked = 0;
  click(): void { this.clicked++; }
  choose(file?: { size: number; text: () => Promise<string> }): void {
    this.files = (file ? [file] : []) as unknown as FileList;
    this.dispatchEvent(new Event("change"));
  }
  cancel(): void { this.dispatchEvent(new Event("cancel")); }
}
const usePicker = (input: FakePicker): Promise<string> =>
  pickBackupFileAsText(() => input as unknown as HTMLInputElement);

afterEach(() => vi.useRealTimers());

describe("browser portable archive picker", () => {
  it("reads exactly the chosen backup and preserves existing accept formats", async () => {
    const input = new FakePicker();
    const result = usePicker(input);
    expect(input.type).toBe("file");
    expect(input.accept).toContain(".tvc");
    expect(input.clicked).toBe(1);
    input.choose({size:4,text:async()=> "data"});
    await expect(result).resolves.toBe("data");
  });

  it("accepts a valid UTF-8 archive text without confusing code units and bytes", async () => {
    const input = new FakePicker();
    const text = "Қазақша🙂";
    const result = usePicker(input);
    input.choose({size:new TextEncoder().encode(text).length,text:async()=>text});
    await expect(result).resolves.toBe(text);
  });

  it("settles immediately on the native cancel event or an empty selection", async () => {
    const cancelled = new FakePicker();
    const promise = usePicker(cancelled);
    cancelled.cancel();
    await expect(promise).rejects.toThrow(/cancelled/);

    const empty = new FakePicker();
    const noFile = usePicker(empty);
    empty.choose();
    await expect(noFile).rejects.toThrow(/No backup file selected/);
  });

  it("rejects an empty file before attempting text decoding", async () => {
    const input = new FakePicker();
    let reads = 0;
    const result = usePicker(input);
    input.choose({size:0,text:async()=>{reads++;return "";}});
    await expect(result).rejects.toThrow(/empty/);
    expect(reads).toBe(0);
  });

  it("rejects an oversized file before reading it", async () => {
    const input = new FakePicker();
    let read = false;
    const result = usePicker(input);
    input.choose({size:MAX_BACKUP_FILE_BYTES+1,text:async()=>{read=true;return "data";}});
    await expect(result).rejects.toThrow(/exceeds supported size/);
    expect(read).toBe(false);
  });

  it("rejects a file whose decoded text exceeds the originally selected bytes", async () => {
    const input = new FakePicker();
    const pending = usePicker(input);
    input.choose({size:3,text:async()=> "abcd"});
    await expect(pending).rejects.toThrow(/changed/);
  });

  it("does not allow a duplicate change event to start a second read", async () => {
    const input = new FakePicker();
    let finish!: (value: string) => void;
    let reads = 0;
    const pending = usePicker(input);
    input.choose({size:1,text:()=>{reads++;return new Promise(resolve=>{finish=resolve;});}});
    input.choose({size:1,text:async()=>{reads++;return "second";}});
    expect(reads).toBe(1);
    finish("a");
    await expect(pending).resolves.toBe("a");
  });

  it("ignores a delayed file read after cancel and propagates read failures", async () => {
    const input = new FakePicker();
    let finish!: (value: string) => void;
    const pending = usePicker(input);
    input.choose({size:3,text:()=>new Promise(resolve=>{finish=resolve;})});
    input.cancel();
    await expect(pending).rejects.toThrow(/cancelled/);
    finish("abc");

    const failed = new FakePicker();
    const promise = usePicker(failed);
    failed.choose({size:3,text:async()=>{throw new Error("Disk read failed");}});
    await expect(promise).rejects.toThrow("Disk read failed");
  });

  it("handles failure opening the picker", async () => {
    class FailedPicker extends FakePicker {
      click(): void { throw new Error("Picker not permitted"); }
    }
    await expect(usePicker(new FailedPicker())).rejects.toThrow("Picker not permitted");
  });
  it("returns a clear error when the selected file never completes reading", async () => {
    vi.useFakeTimers();
    const input = new FakePicker();
    const pending = pickBackupFileAsText(
      () => input as unknown as HTMLInputElement, 80,
    );
    input.choose({ size: 100, text: () => new Promise<string>(() => {}) });
    const assertion = expect(pending).rejects.toThrow(/read timed out/);
    await vi.advanceTimersByTimeAsync(80);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late file response after timeout, leaving restored data unchanged", async () => {
    vi.useFakeTimers();
    const input = new FakePicker();
    let finishRead!: (text: string) => void;
    const pending = pickBackupFileAsText(
      () => input as unknown as HTMLInputElement, 80,
    );
    input.choose({ size: 8, text: () => new Promise(resolve => { finishRead = resolve; }) });
    const assertion = expect(pending).rejects.toThrow(/read timed out/);
    await vi.advanceTimersByTimeAsync(80);
    await assertion;
    finishRead("private");
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the read deadline on success, cancellation and immediate validation errors", async () => {
    vi.useFakeTimers();
    const success = new FakePicker();
    const resolved = pickBackupFileAsText(
      () => success as unknown as HTMLInputElement, 50,
    );
    success.choose({ size: 3, text: async () => "abc" });
    await expect(resolved).resolves.toBe("abc");
    expect(vi.getTimerCount()).toBe(0);

    const cancelled = new FakePicker();
    const stopped = pickBackupFileAsText(
      () => cancelled as unknown as HTMLInputElement, 50,
    );
    cancelled.choose({ size: 100, text: () => new Promise<string>(() => {}) });
    cancelled.cancel();
    await expect(stopped).rejects.toThrow(/cancelled/);
    expect(vi.getTimerCount()).toBe(0);

    const malformed = new FakePicker();
    const refused = pickBackupFileAsText(
      () => malformed as unknown as HTMLInputElement, 50,
    );
    malformed.choose({ size: -1, text: async () => "abc" });
    await expect(refused).rejects.toThrow(/exceeds supported size/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects impossible timeout configuration before opening the picker", async () => {
    for (const timeout of [0, -1, 0.5, Number.POSITIVE_INFINITY, 600_001]) {
      const input = new FakePicker();
      await expect(pickBackupFileAsText(
        () => input as unknown as HTMLInputElement, timeout,
      )).rejects.toThrow(/Invalid backup read timeout/);
      expect(input.clicked).toBe(0);
    }
  });

});
