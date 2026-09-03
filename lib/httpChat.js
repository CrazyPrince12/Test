// Couche HTTP partagée entre :
//  - server.js          (serveur Node natif → Render, local, preview sandbox)
//  - api/chat.js        (fonction serverless → Vercel)
//
// Protocole de réponse :
//  - Non-stream : JSON { reply, usage, model }
//  - Stream     : SSE "data: {delta}"… puis "data: [DONE]"
//                 (une ligne "data: {error}" peut précéder [DONE] en cas d'échec)

import { getConfig, DEFAULT_MAX_TOKENS, DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE } from "./config.js";
import { validateChatPayload, applySystemPrompt, ValidationError } from "./messages.js";
import { DolphinError, generateReply, streamReply, demoStream, demoTextFrom, mapProviderError } from "./dolphin.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...JSON_HEADERS, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, err) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const payload = {
    error: {
      status,
      message: err?.message || "Erreur interne du serveur.",
      ...(err?.detail ? { detail: err.detail } : {}),
    },
  };
  sendJson(res, status, payload);
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/** Lit un corps de requête JSON (limite 1 Mo). */
export async function readJsonBody(req, limitBytes = 1_048_576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new ValidationError("Requête trop volumineuse (max 1 Mo).");
    chunks.push(chunk);
  }
  if (chunks.length === 0) throw new ValidationError("Corps de requête vide.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("JSON invalide dans le corps de la requête.");
  }
}

function prepare(body, env) {
  const cfg = getConfig(env);
  const payload = validateChatPayload(body);
  const messages = applySystemPrompt(payload);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return {
    cfg,
    payload,
    callParams: {
      apiKey: cfg.apiKey,
      model: cfg.model,
      provider: cfg.provider,
      messages,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    },
    lastUser,
  };
}

/**
 * Point d'entrée unique : traite POST /api/chat.
 * Renvoie true si la requête a été gérée.
 */
export async function handleChatHttp(req, res, env = process.env) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: { status: 405, message: "Méthode non autorisée : utilisez POST." } });
    return true;
  }

  let prep;
  try {
    const body = await readJsonBody(req);
    prep = prepare(body, env);
  } catch (err) {
    sendError(res, err instanceof ValidationError ? err : mapProviderError(err));
    return true;
  }

  const { cfg, payload, callParams, lastUser } = prep;

  if (payload.stream) {
    res.writeHead(200, SSE_HEADERS);
    // Heartbeat immédiat pour ouvrir le flux côté client.
    sseSend(res, { status: "started", model: cfg.model, provider: cfg.provider, demo: cfg.demoMode });
    try {
      const deltas = cfg.demoMode ? demoStream(lastUser) : streamReply(callParams);
      for await (const delta of deltas) {
        sseSend(res, { delta });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      const e = mapProviderError(err);
      sseSend(res, { error: { status: e.status, message: e.message, detail: e.detail } });
      res.write("data: [DONE]\n\n");
      res.end();
    }
    return true;
  }

  try {
    if (cfg.demoMode) {
      sendJson(res, 200, {
        reply: demoTextFrom(lastUser),
        usage: null,
        model: cfg.model,
        provider: cfg.provider,
        demo: true,
      });
      return true;
    }
    const { reply, usage, model } = await generateReply(callParams);
    sendJson(res, 200, { reply, usage, model, provider: cfg.provider, demo: false });
  } catch (err) {
    sendError(res, mapProviderError(err));
  }
  return true;
}

/** GET /api/health : état + défauts exposés au frontend. */
export function handleHealthHttp(_req, res, env = process.env) {
  const cfg = getConfig(env);
  sendJson(res, 200, {
    ok: true,
    model: cfg.model,
    provider: cfg.provider,
    keyConfigured: Boolean(cfg.apiKey),
    demoMode: cfg.demoMode,
    defaults: {
      temperature: DEFAULT_TEMPERATURE,
      maxTokens: DEFAULT_MAX_TOKENS,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    },
  });
}
