import { proxyToApi } from "@/lib/bff/proxy";

/** The browser's only door to the API: /api/v1/* → ${API_INTERNAL_URL}/v1/* (ADR-0005). */
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly path: string[] }>;
}

async function handle(request: Request, { params }: RouteContext): Promise<Response> {
  return proxyToApi(request, (await params).path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
