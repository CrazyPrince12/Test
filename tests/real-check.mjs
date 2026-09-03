// Vérification RÉELLE de l'API Hugging Face (hors `npm test` :
// nécessite un accès réseau à huggingface.co + une clé valide avec des
// crédits/provider compatibles).
//
// Usage : node tests/real-check.mjs
// Suit exactement la structure OpenAI de la fiche du modèle :
//   new OpenAI({ baseURL: "https://router.huggingface.co/v1", apiKey: process.env.HF_TOKEN })
//   client.chat.completions.create({ model: "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai", ... })

import { OpenAI } from "openai";
import { loadDotEnv } from "../lib/env.js";
import { getConfig } from "../lib/config.js";
import { mapProviderError } from "../lib/dolphin.js";

loadDotEnv();
const cfg = getConfig();

const result = {
  when: new Date().toISOString(),
  baseURL: cfg.baseURL,
  model: cfg.modelId,
  keyConfigured: Boolean(cfg.apiKey),
  keyPrefix: cfg.apiKey ? cfg.apiKey.slice(0, 6) + "…" : null,
  steps: {},
};

if (!cfg.apiKey) {
  result.steps.config = { ok: false, error: "HF_TOKEN absente" };
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

const messages = [
  { role: "system", content: "You are Dolphin Mistral 24B Venice Edition." },
  { role: "user", content: "Réponds en une phrase : qui es-tu ?" },
];

// Étape 1 : whoami (la clé est-elle acceptée par le Hub ?)
try {
  const r = await fetch("https://huggingface.co/api/whoami-v2", {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => null);
  result.steps.whoami = {
    ok: r.ok,
    status: r.status,
    user: data?.name ?? null,
    detail: r.ok ? undefined : JSON.stringify(data)?.slice(0, 200),
  };
} catch (e) {
  result.steps.whoami = { ok: false, networkError: String(e?.cause?.code ?? e?.message ?? e) };
}

// Client OpenAI pointé sur le router HF — structure exacte de la fiche.
const client = new OpenAI({
  baseURL: cfg.baseURL, // "https://router.huggingface.co/v1"
  apiKey: cfg.apiKey, // process.env.HF_TOKEN
  timeout: 45000,
  maxRetries: 0,
});

// Étape 2 : chatCompletion non-streamée (comme l'extrait de la fiche).
try {
  const chatCompletion = await client.chat.completions.create({
    model: cfg.modelId, // "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai"
    messages,
    temperature: 0.15, // recommandé par la fiche
    max_tokens: 64,
  });
  result.steps.chatCompletion = {
    ok: true,
    modelReturned: chatCompletion.model,
    // console.log(chatCompletion.choices[0].message) — comme dans la fiche :
    message: chatCompletion.choices[0].message,
    usage: chatCompletion.usage,
  };
} catch (e) {
  const m = mapProviderError(e);
  result.steps.chatCompletion = { ok: false, status: m.status, message: m.message, detail: m.detail };
}

// Étape 3 : même appel avec stream: true.
try {
  let text = "";
  let chunks = 0;
  const stream = await client.chat.completions.create({
    model: cfg.modelId,
    messages,
    temperature: 0.15,
    max_tokens: 48,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") {
      text += delta;
      chunks++;
    }
  }
  result.steps.chatCompletionStream = { ok: true, chunks, reply: text.slice(0, 300) };
} catch (e) {
  const m = mapProviderError(e);
  result.steps.chatCompletionStream = { ok: false, status: m.status, message: m.message, detail: m.detail };
}

result.overall = Object.values(result.steps).every((s) => s.ok) ? "✅ RÉUSSI" : "❌ ÉCHEC (voir steps)";
console.log(JSON.stringify(result, null, 2));
