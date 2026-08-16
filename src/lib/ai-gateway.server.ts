import { createOpenAI } from "@ai-sdk/openai";

const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export function getLovableAiGatewayRunId(request: Request): string | undefined {
  return request.headers.get(RUN_ID_HEADER) ?? undefined;
}

/**
 * Wraps fetch so the gateway-minted run id is captured and resent on every
 * follow-up request inside the same call.
 */
export function createLovableAiGatewayRunIdFetch(initialRunId?: string) {
  let runId = initialRunId;
  const wrapped: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (runId) headers.set(RUN_ID_HEADER, runId);
    const response = await fetch(input, { ...init, headers });
    const minted = response.headers.get(RUN_ID_HEADER);
    if (minted) runId = minted;
    return response;
  };
  return {
    fetch: wrapped,
    get runId() {
      return runId;
    },
  };
}

export function withLovableAiGatewayRunIdHeader(
  response: Response,
  holder: { runId?: string },
) {
  if (holder.runId) response.headers.set(RUN_ID_HEADER, holder.runId);
  return response;
}

export function createResponsesProvider(request: Request) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: {
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });
  return { provider, runIdFetch };
}
