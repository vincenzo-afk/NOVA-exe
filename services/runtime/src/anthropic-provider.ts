import type { LlmProvider, ModelRequest, ModelResponse, HealthState } from "./model-router.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderOptions {
  readonly providerId: string;
  readonly model: string;
  readonly authReference: string;
  readonly resolveCredential: (reference: string) => Promise<string>;
  readonly endpoint?: string;
  readonly fetcher?: typeof fetch;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly costPer1kTokens?: number;
}

interface AnthropicMessageResponse {
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly error?: { readonly message?: string };
}

/**
 * The first `LlmProvider` implementation actually constructed anywhere
 * in production code — `GroqProvider` was real but only ever
 * instantiated in its own test file, so the runtime's capability
 * catalog declared a `text-generation` slot with nothing registered
 * against it. This follows the exact same pattern `GroqProvider`
 * already established (descriptor, healthCheck, invoke, credential
 * resolution via an injected callback so this composes with
 * `CredentialStore`/`VaultBackend` unchanged) against the real
 * Anthropic Messages API instead of a second test-only client.
 */
export class AnthropicProvider implements LlmProvider {
  public readonly descriptor: LlmProvider["descriptor"];
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly options: AnthropicProviderOptions;

  public constructor(options: AnthropicProviderOptions) {
    this.options = options;
    this.endpoint = (options.endpoint ?? ANTHROPIC_ENDPOINT).replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
    this.descriptor = {
      provider_id: options.providerId,
      domain: "llm",
      privacy_class: "cloud",
      schema_version: "1.0.0",
      cost_per_1k_tokens: options.costPer1kTokens ?? 0,
      capabilities: {
        tool_calls: true,
        vision_input: true,
        streaming: true,
        max_context_tokens: options.maxContextTokens ?? 200_000,
      },
    };
  }

  public async healthCheck(): Promise<HealthState> {
    try {
      // Anthropic has no unauthenticated /models probe worth relying on for
      // health; a 1-token request against the real messages endpoint is the
      // most honest reachability signal available without special-casing.
      const response = await this.rawInvoke([{ role: "user", content: "ping" }], undefined, 1);
      return response.ok ? "reachable" : response.status === 401 ? "down" : "degraded";
    } catch {
      return "down";
    }
  }

  public async invoke(request: ModelRequest): Promise<ModelResponse> {
    if (!request.messages || request.messages.length === 0) {
      throw new Error("Anthropic requests require at least one chat message.");
    }
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const turns = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));
    if (turns.length === 0) {
      throw new Error("Anthropic requests require at least one non-system chat message.");
    }

    const response = await this.rawInvoke(turns, system.length > 0 ? system : undefined, 4096, request.temperature);
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as AnthropicMessageResponse | undefined;
      throw new Error(
        `Anthropic request failed with status ${response.status}${body?.error?.message ? `: ${body.error.message}` : "."}`,
      );
    }
    const payload = (await response.json()) as AnthropicMessageResponse;
    const text = payload.content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    if (!text) {
      throw new Error("Anthropic response did not contain any text content.");
    }
    return { text, provider_id: this.options.providerId };
  }

  private async rawInvoke(
    messages: readonly { readonly role: string; readonly content: string }[],
    system: string | undefined,
    maxTokens: number,
    temperature?: number,
  ): Promise<Response> {
    const credential = await this.options.resolveCredential(this.options.authReference);
    const headers = new Headers({
      "content-type": "application/json",
      "x-api-key": credential,
      "anthropic-version": ANTHROPIC_VERSION,
    });
    return this.fetcher(`${this.endpoint}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        messages,
      }),
    });
  }
}
