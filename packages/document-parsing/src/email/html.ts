/** HTML -> plain text without a DOM (html-to-text), for .msg HTML bodies and text/html MIME parts. */
import { convert } from "html-to-text";

const NBSP = String.fromCharCode(160);

/** Headings keep their case; links show their text only. Lists keep html-to-text's ` * ` bullets. */
export function htmlToPlainText(html: string): string {
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "head", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
      { selector: "table", format: "block" },
    ],
  });
  return text
    .replaceAll(NBSP, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
