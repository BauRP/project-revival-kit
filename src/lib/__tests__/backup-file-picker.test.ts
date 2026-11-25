import { describe, expect, it } from "vitest";
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

  it("rejects an oversized file before reading it", async () => {
    const input = new FakePicker();
    let read = false;
    const result = usePicker(input);
    input.choose({size:MAX_BACKUP_FILE_BYTES+1,text:async()=>{read=true;return "data";}});
    await expect(result).rejects.toThrow(/exceeds supported size/);
    expect(read).toBe(false);
  });

  it("rejects files larger than their reported size after asynchronous read", async () => {
    const input = new FakePicker();
    const pending = usePicker(input);
    // Simulate a file swapped during read without allocating 360 MiB in a test.
    input.choose({size:3,text:async()=> ({length:MAX_BACKUP_FILE_BYTES+1} as unknown as string)});
    await expect(pending).rejects.toThrow(/exceeds supported size/);
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
});
