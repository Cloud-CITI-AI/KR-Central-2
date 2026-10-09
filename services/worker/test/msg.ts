import * as CFB from "cfb";

/** A minimal Outlook .msg: subject, sender, recipients, plain body and a submit time (UTF-16 property streams). */
export function makeMsg(m: { subject: string; body: string; to?: string; sentAt?: string }): Buffer {
  const container = CFB.utils.cfb_new();
  const props: Record<string, string> = {
    "0037": m.subject,
    "1000": m.body,
    "5D01": "sender@example.test",
    "0E04": m.to ?? "",
  };
  for (const [id, value] of Object.entries(props)) {
    CFB.utils.cfb_add(container, `/__substg1.0_${id}001F`, Buffer.from(`${value}\0`, "utf16le"));
  }
  const properties = Buffer.alloc(48);
  if (m.sentAt) {
    properties.writeUInt32LE((0x0039 << 16) | 0x40, 32);
    properties.writeBigUInt64LE(BigInt(Date.parse(m.sentAt) + 11_644_473_600_000) * 10_000n, 40);
  }
  CFB.utils.cfb_add(container, "/__properties_version1.0", properties);
  return CFB.write(container, { type: "buffer" }) as Buffer;
}
