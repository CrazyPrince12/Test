// Vérification RÉELLE de l'API Hugging Face (hors `npm test` :
// nécessite un accès réseau à huggingface.co + une clé valide avec des
// crédits/provider compatibles).
//
// Usage : node tests/real-check.mjs
// Résultat : JSON structuré imprimé sur stdout (utilisé dans RAPPORT_TEST.md).

import { loadDotEnv } from "../lib/env.js";
import { getConfig } from "../lib/config.js";
import { generateReply, streamReply, mapProviderError } from "../lib/dolphin.js";

loadDotEnv();
const cfg = getConfig();

const result = {
  when: new Date().toISOString(),
  model: cfg.model,
  provider: cfg.provider,
  keyConfigured: Boolean(cfg.apiKey),
  keyPrefix: cfg.apiKey ? cfg.apiKey.slice(0, 6) + "…" : null,
  steps: {},
};

if (!cfg.apiKey) {
  result.steps.config = { ok: false, error: "HF_API_KEY absente" };
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

const messages = [
  { role: "system", content: "You are Dolphin Mistral 24B Venice Edition." },
  { role: "user", content: "Réponds en une phrase : qui es-tu ?" },
];

// Étape 1 : whoami (le compte existe-t-il ? la clé est-elle acceptée ?)
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

// Étape 2 : génération non-streamée via le SDK officiel.
try {
  const out = await generateReply({
    apiKey: cfg.apiKey,
    model: cfg.model,
    provider: cfg.provider,
    messages,
    temperature: 0.15,
    maxTokens: 64,
    signal: AbortSignal.timeout(45000),
  });
  result.steps.chatCompletion = {
    ok: true,
    modelReturned: out.model,
    reply: out.reply.slice(0, 300),
    usage: out.usage,
  };
} catch (e) {
  const m = mapProviderError(e);
  result.steps.chatCompletion = { ok: false, status: m.status, message: m.message, detail: m.detail };
}

// Étape 3 : streaming via le SDK officiel.
try {
  let text = "";
  let chunks = 0;
  for await (const d of streamReply({
    apiKey: cfg.apiKey,
    model: cfg.model,
    provider: cfg.provider,
    messages,
    temperature: 0.15,
    maxTokens: 48,
    signal: AbortSignal.timeout(45000),
  })) {
    text += d;
    chunks++;
  }
  result.steps.chatCompletionStream = { ok: true, chunks, reply: text.slice(0, 300) };
} catch (e) {
  const m = mapProviderError(e);
  result.steps.chatCompletionStream = { ok: false, status: m.status, message: m.message, detail: m.detail };
}

result.overall = Object.values(result.steps).every((s) => s.ok) ? "✅ RÉUSSI" : "❌ ÉCHEC (voir steps)";
console.log(JSON.stringify(result, null, 2));
