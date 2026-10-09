/**
 * Entry point of the parse thread (ADR-0011): runs ONE document task from `workerData` and posts the result. It holds no
 * database or storage handle and gets an empty environment; the parent enforces the heap cap and the time limit.
 */
import { parentPort, workerData } from "node:worker_threads";
import {
  DocumentParseError,
  parseEml,
  parseMsg,
  pdfFirstPage,
  pdfTextLines,
  renderFirstPagePng,
} from "@kr/document-parsing";
import type { TaskRequest, ThreadReply } from "./tasks.js";

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

async function run(request: TaskRequest): Promise<unknown> {
  switch (request.task) {
    case "pdf-text":
      return pdfTextLines(request.data, { maxPages: request.maxPages });
    case "pdf-first-page":
      return pdfFirstPage(request.data, { maxPages: request.maxPages });
    case "pdf-render":
      return renderFirstPagePng(request.data, { limits: { maxPages: request.maxPages } });
    case "email":
      return CFB_MAGIC.every((byte, i) => request.data[i] === byte) ? parseMsg(request.data) : parseEml(request.data);
  }
}

const reply = (message: ThreadReply): void => {
  parentPort?.postMessage(message);
};

run(workerData as TaskRequest).then(
  (value) => {
    reply({ ok: true, value });
  },
  (error: unknown) => {
    reply({ ok: false, code: error instanceof DocumentParseError ? error.code : "parse_failed" });
  },
);
