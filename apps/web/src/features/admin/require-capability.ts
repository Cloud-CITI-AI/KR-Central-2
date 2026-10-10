import type { GlobalCapability, Me } from "@kr/contracts";
import { hasCapability } from "@kr/contracts/capabilities";
import { notFound } from "next/navigation";
import { getMe } from "@/lib/session/get-me";

/**
 * Server-side gate of an admin page: without the capability the page does not exist for this person (the not-found
 * page, §4). The API enforces the same rule on every call; this only stops the page from rendering at all.
 */
export async function requireCapability(capability: GlobalCapability): Promise<Me> {
  const me = await getMe();
  if (!hasCapability(me.capabilities, capability)) notFound();
  return me;
}
