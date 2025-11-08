const HF_TOKEN = process.env.HF_TOKEN!;
const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
// Using Qwen2.5-7B-Instruct - excellent instruction following + Russian support
// Much better than Zephyr for structured output
const MODEL = "Qwen/Qwen2.5-7B-Instruct";

export async function hfChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens = 512,
  temperature = 0,
  forceJson = false // новый параметр
): Promise<string> {
  const bodyData: any = {
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  // JSON-режим только если явно запрошен
  if (forceJson) {
    bodyData.response_format = { type: "json_object" };
  }

  const res = await fetch(HF_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyData),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`HF router ${res.status}: ${JSON.stringify(data)}`);
  }

  return data?.choices?.[0]?.message?.content ?? "";
}
