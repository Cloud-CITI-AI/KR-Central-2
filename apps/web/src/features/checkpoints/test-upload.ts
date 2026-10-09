import { vi } from "vitest";

/** XMLHttpRequest stand-in: records what the upload helper sends and lets a test drive progress and the answer. */
export class FakeXHR {
  static instances: FakeXHR[] = [];
  static onSend: ((xhr: FakeXHR) => void) | undefined;
  url = "";
  headers: Record<string, string> = {};
  body: FormData | undefined;
  status = 0;
  responseText = "";
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return name === "x-request-id" ? "req-up-1" : null;
  }
  send(body: FormData) {
    this.body = body;
    FakeXHR.onSend?.(this);
  }
  abort() {
    this.onabort?.();
  }
  progress(fraction: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: fraction * 100, total: 100 });
  }
  finish(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
  /** The text fields and the file of the multipart body. */
  get fields(): { checkpointKey: string | null; slot: string | null; file: string | null } {
    const text = (name: string) => (typeof this.body?.get(name) === "string" ? (this.body.get(name) as string) : null);
    const file = this.body?.get("file");
    return { checkpointKey: text("checkpointKey"), slot: text("slot"), file: file instanceof File ? file.name : null };
  }
}

/** Route `XMLHttpRequest` to the fake for the current test (call `vi.unstubAllGlobals()` after). Returns the requests made. */
export function stubUploads(onSend?: (xhr: FakeXHR) => void): FakeXHR[] {
  FakeXHR.instances = [];
  FakeXHR.onSend = onSend;
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  return FakeXHR.instances;
}
