// Faux "router Hugging Face" pour les tests : imite l'API OpenAI-compatible
// qu'utilise le SDK @huggingface/inference pour les providers
// (POST {router}/{provider}/v1/chat/completions).
//
//  - Authorization: Bearer test-key-hf requis (sinon 401, format HF)
//  - stream:true  → SSE de chunks OpenAI "chat.completion.chunk" + [DONE]
//  - stream:false → JSON "chat.completion"
//  - "TRIGGER_402/429/500" dans le dernier message user → erreurs simulées

import { createServer } from "node:http";

// Le SDK n'envoie l'en-tête Authorization vers l'API Hub que pour les tokens
// commençant par "hf_" : la clé de test doit donc respecter ce format.
export const MOCK_KEY = "hf_testkey0000000000000000000000000000";

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

export function startMockRouter() {
  const server = createServer(async (req, res) => {
    // Le SDK résout d'abord le modèle via l'API Hub :
    //   GET /api/models/{id}?expand[]=inferenceProviderMapping
    if (req.method === "GET" && req.url.startsWith("/api/models/")) {
      const modelId = decodeURIComponent(
        req.url.replace("/api/models/", "").split("?")[0]
      );
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${MOCK_KEY}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid username or password." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: modelId,
          inferenceProviderMapping: [
            {
              provider: "featherless-ai",
              hfModelId: modelId,
              providerId: modelId,
              status: "live",
              task: "conversational",
            },
          ],
        })
      );
      return;
    }

    if (req.method !== "POST" || !req.url.includes("/v1/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);

    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${MOCK_KEY}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid username or password." } }));
      return;
    }

    const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";

    if (lastUser.includes("TRIGGER_402")) {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "You have exceeded your monthly included credits." } }));
      return;
    }
    if (lastUser.includes("TRIGGER_429")) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded." } }));
      return;
    }
    if (lastUser.includes("TRIGGER_500")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Upstream provider exploded." } }));
      return;
    }

    const text = `MOCK-OK: ${lastUser}`;
    const modelUsed = body.model ?? "mock-model";

    if (body.stream === true) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const parts = text.split(/(?<= )/); // mots avec espaces
      let i = 0;
      for (const p of parts) {
        sse(res, {
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          created: 1700000000,
          model: modelUsed,
          choices: [{ index: 0, delta: { content: p }, finish_reason: null }],
        });
        i++;
      }
      sse(res, {
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: 1700000000,
        model: modelUsed,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: 1700000000,
        model: modelUsed,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      })
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/** fetch qui réécrit les hôtes HF (hub + router) vers le mock local. */
export function makeRedirectFetch(mockUrl) {
  return (url, init) =>
    fetch(
      String(url)
        .replace("https://router.huggingface.co", mockUrl)
        .replace("https://huggingface.co", mockUrl),
      init
    );
}
