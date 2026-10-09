/** `oidc-provider` ships no types: this is the slice of it that the mock uses. */
import type { IncomingMessage as Req, ServerResponse as Res } from "node:http";

interface Grant {
  addOIDCScope(scope: string): void;
  save(): Promise<string>;
}
interface GrantStatic {
  new (data: { clientId: string; accountId: string }): Grant;
  find(id: string): Promise<Grant | undefined>;
}
export interface OidcContext {
  body?: string;
  oidc: {
    client: { clientId: string };
    session: { accountId: string; grantIdFor(clientId: string): string | undefined };
    result?: { consent?: { grantId?: string } };
    provider: { Grant: GrantStatic };
  };
}
export interface Provider {
  readonly Client: {
    readonly prototype: {
      redirectUriAllowed(uri: string): boolean;
      postLogoutRedirectUriAllowed(uri: string): boolean;
    };
  };
  callback(): (req: Req, res: Res) => void;
  interactionDetails(req: Req, res: Res): Promise<{ uid: string; params: Record<string, string | undefined> }>;
  interactionFinished(
    req: Req,
    res: Res,
    result: object,
    options?: { mergeWithLastSubmission?: boolean },
  ): Promise<void>;
}
export type ProviderConstructor = new (issuer: string, configuration: Record<string, unknown>) => Provider;

/** Loaded through a variable specifier so TypeScript does not look for declarations the package does not have. */
export async function loadProvider(): Promise<ProviderConstructor> {
  const specifier = "oidc-provider";
  return ((await import(specifier)) as { default: ProviderConstructor }).default;
}
