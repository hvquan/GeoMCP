/**
 * LLM Adapter — Layer 4
 *
 * Hides the differences between LLM providers (OpenAI, Ollama, etc.).
 * Any code that needs to call an LLM goes through this module.
 * Swapping models or providers only requires changes here.
 */

export interface LlmCallOptions {
  model?: string;
}

export interface LlmApiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface LlmResponse {
  text: string;
  model: string;
}

function normalizeModelName(model: string): string {
  const name = (model || "").trim();
  if (!name) return "gpt-4.1-mini";
  if (name === "gemini-1.5-flash") return "gemini-2.0-flash";
  return name;
}

function nextFallbackModel(model: string): string | null {
  if (model === "gemini-2.0-flash") return "gemini-2.5-flash";
  return null;
}

function isLocalOpenAICompatibleBaseUrl(baseUrl: string): boolean {
  return /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(baseUrl);
}

export function getApiConfig(options: LlmCallOptions): LlmApiConfig {
  const baseUrl = (
    process.env.GEOMCP_OPENAI_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const apiKey = process.env.GEOMCP_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey && !isLocalOpenAICompatibleBaseUrl(baseUrl)) {
    throw new Error(
      "Missing API key. Set GEOMCP_OPENAI_API_KEY or OPENAI_API_KEY to use hosted LLM parser."
    );
  }
  const model = normalizeModelName(
    options.model ??
    process.env.GEOMCP_OPENAI_MODEL ??
    process.env.OPENAI_MODEL ??
    "gpt-4.1-mini"
  );
  return { apiKey, model, baseUrl };
}

export function parseChatCompletionContent(payload: unknown): string {
  const p = payload as any;
  const content = p?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n");
    if (text.trim()) return text;
  }
  throw new Error("Unexpected chat completion response format");
}

/**
 * Call the LLM with a list of messages and return the response text.
 * Handles model fallback (e.g. gemini-2.0-flash → gemini-2.5-flash on 404).
 */
export async function callLlm(
  messages: { role: string; content: string }[],
  options: LlmCallOptions = {}
): Promise<LlmResponse> {
  const { apiKey, model, baseUrl } = getApiConfig(options);

  const isLocal = isLocalOpenAICompatibleBaseUrl(baseUrl);

  // For local Ollama, use native /api/chat endpoint which supports think:false
  if (isLocal) {
    const ollamaBase = baseUrl.replace(/\/v1\/?$/, "");
    const body = {
      model,
      think: false,
      stream: false,
      options: { num_ctx: 8192, seed: 42, top_k: 1, temperature: 0 },
      messages,
    };
    const response = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API error ${response.status} (model=${model}): ${errText}`);
    }
    const payload = await response.json() as any;
    const text = payload?.message?.content;
    if (typeof text !== "string") throw new Error("Unexpected Ollama response format");
    return { text, model };
  }

  const postCompletion = async (modelName: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        top_p: 1,
        max_tokens: 800,
        messages,
      }),
    });
  };

  let selectedModel = model;
  let response = await postCompletion(selectedModel);
  if (!response.ok && response.status === 404) {
    const fallback = nextFallbackModel(selectedModel);
    if (fallback) {
      selectedModel = fallback;
      response = await postCompletion(selectedModel);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status} (model=${selectedModel}): ${errText}`);
  }

  const payload = await response.json();
  const text = parseChatCompletionContent(payload);
  return { text, model: selectedModel };
}
