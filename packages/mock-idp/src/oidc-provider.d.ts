/** The slice of `oidc-provider` (ships no types) that the mock uses. */
declare module "oidc-provider" {
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
  export default class Provider {
    constructor(issuer: string, configuration: Record<string, unknown>);
    readonly Client: { readonly prototype: { redirectUriAllowed(uri: string): boolean } };
    callback(): (req: Req, res: Res) => void;
    interactionDetails(req: Req, res: Res): Promise<{ uid: string; params: Record<string, string | undefined> }>;
    interactionFinished(
      req: Req,
      res: Res,
      result: object,
      options?: { mergeWithLastSubmission?: boolean },
    ): Promise<void>;
  }
}
