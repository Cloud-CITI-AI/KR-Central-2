import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { SyntheticFile } from "./documents";

// A synthetic AES-256 (PDF 2.0, revision 6) PDF with an owner password only: it opens without a password, like the permission-locked
// PDFs agencies send. pdf-lib cannot encrypt, so this writes the file and ISO 32000-2 §7.6.4 / 7.6.5 itself. Nothing here is real data (TD-1).

const sha = (algorithm: "sha256" | "sha384" | "sha512", data: Buffer): Buffer =>
  createHash(algorithm).update(data).digest();

/** ISO 32000-2 algorithm 2.B: the revision 6 password hash. `udata` is the 48 byte U string when hashing the owner password. */
function hash2B(password: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = sha("sha256", Buffer.concat([password, salt, udata]));
  for (let round = 0; ; round++) {
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([password, k, udata])));
    const aes = createCipheriv("aes-128-cbc", k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    const e = Buffer.concat([aes.update(k1), aes.final()]);
    const mod = e.subarray(0, 16).reduce((sum, byte) => sum + byte, 0) % 3;
    k = sha(mod === 0 ? "sha256" : mod === 1 ? "sha384" : "sha512", e);
    if (round >= 63 && (e[e.length - 1] ?? 0) <= round - 31) return k.subarray(0, 32);
  }
}

const aesNoPadding = (mode: "aes-256-cbc" | "aes-256-ecb", key: Buffer, data: Buffer): Buffer => {
  const cipher = createCipheriv(mode, key, mode === "aes-256-cbc" ? Buffer.alloc(16) : null).setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
};

const hex = (bytes: Buffer): string => `<${bytes.toString("hex")}>`;

/** One page of text (standard Helvetica), encrypted with a random file key; the user password is empty and the owner password is `owner`. */
export function aes256OwnerPasswordPdf(name: string, lines: readonly string[]): SyntheticFile {
  const fileKey = randomBytes(32);
  const owner = Buffer.from("owner");
  const noPassword = Buffer.alloc(0);

  const userValidation = randomBytes(8);
  const userKeySalt = randomBytes(8);
  const u = Buffer.concat([hash2B(noPassword, userValidation, Buffer.alloc(0)), userValidation, userKeySalt]);
  const ue = aesNoPadding("aes-256-cbc", hash2B(noPassword, userKeySalt, Buffer.alloc(0)), fileKey);
  const ownerValidation = randomBytes(8);
  const ownerKeySalt = randomBytes(8);
  const o = Buffer.concat([hash2B(owner, ownerValidation, u), ownerValidation, ownerKeySalt]);
  const oe = aesNoPadding("aes-256-cbc", hash2B(owner, ownerKeySalt, u), fileKey);
  const permissions = Buffer.alloc(16, 0xff);
  permissions.writeInt32LE(-4, 0); // every permission except the owner-only ones
  permissions.write("Tadb", 8, "ascii"); // metadata is encrypted, then the literal "adb"
  randomBytes(4).copy(permissions, 12);
  const perms = aesNoPadding("aes-256-ecb", fileKey, permissions);

  const text = lines.map((line, i) => `BT /F1 12 Tf 50 ${(780 - i * 18).toString()} Td (${line}) Tj ET`).join("\n");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", fileKey, iv);
  const content = Buffer.concat([iv, cipher.update(text, "utf8"), cipher.final()]);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length.toString()} >>\nstream\n`),
      content,
      Buffer.from("\nendstream"),
    ]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Filter /Standard /V 5 /R 6 /Length 256 /P -4 /EncryptMetadata true /CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF /O ${hex(o)} /U ${hex(u)} /OE ${hex(oe)} /UE ${hex(ue)} /Perms ${hex(perms)} >>`,
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-2.0\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  objects.forEach((body, index) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${(index + 1).toString()} 0 obj\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    length += part.length;
  });
  const xref = [
    `xref\n0 ${(objects.length + 1).toString()}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`),
  ].join("");
  const id = hex(randomBytes(16));
  parts.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${(objects.length + 1).toString()} /Root 1 0 R /Encrypt 6 0 R /ID [${id} ${id}] >>\nstartxref\n${length.toString()}\n%%EOF\n`,
    ),
  );
  return { name, mimeType: "application/pdf", buffer: Buffer.concat(parts) };
}
