// Phase 3 §2 — server-only speech-to-text implementation.

export interface TranscribeAudioInput {
  audioUrl: string;
}

export type TranscribeAudioResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function transcribeAudioServer({ audioUrl }: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "LOVABLE_API_KEY is not configured" };
  }

  try {
    // Fetch the audio bytes server-side and inline as base64.
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      return { ok: false, error: `audio_fetch_${audioRes.status}` };
    }

    const mime = audioRes.headers.get("content-type") || "audio/webm";
    const buf = new Uint8Array(await audioRes.arrayBuffer());
    // Hard cap ~10 MB to keep the gateway request small.
    if (buf.byteLength > 10 * 1024 * 1024) {
      return { ok: false, error: "audio_too_large" };
    }

    // Base64 encode (chunked to avoid call-stack issues on large arrays).
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    const b64 = btoa(binary);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a speech-to-text engine. Transcribe the user's audio verbatim in its original spoken language. Output ONLY the transcript text — no quotes, no prefixes, no commentary.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe this voice message." },
              {
                type: "input_audio",
                input_audio: { data: b64, format: mime.includes("mp3") ? "mp3" : "webm" },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return { ok: false, error: "rate_limited" };
      if (response.status === 402) return { ok: false, error: "payment_required" };
      const t = await response.text();
      console.error("[transcribe] gateway error", response.status, t);
      return { ok: false, error: `gateway_${response.status}` };
    }

    const json = await response.json();
    const text: string | undefined = json?.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "empty_response" };
    return { ok: true, text };
  } catch (e) {
    console.error("[transcribe] failure", e);
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}