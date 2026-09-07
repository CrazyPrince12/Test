// Configuration centralisée de Venice — source de vérité unique.
//
// Venice tourne sur le modèle dphn/Dolphin-Mistral-24B-Venice-Edition :
// https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition
//
// 🔐 SÉCURITÉ — la clé ne vit JAMAIS dans ce dépôt :
//   `getConfig()` lit `HF_TOKEN` (ou `HF_API_KEY`) depuis les variables
//   d'environnement, injectées par l'hébergeur :
//     - Render : Dashboard → votre service → Environment → HF_TOKEN
//     - Vercel : Settings → Environment Variables → HF_TOKEN
//   Le fichier render.yaml déclare déjà HF_TOKEN en `sync: false` :
//   Render vous la demande au déploiement et elle reste chiffrée côté Render.
//   En local, `lib/env.js` charge `.env` (fichier ignoré par git) — la clé
//   n'apparaît donc jamais dans un commit.

import { VENICE_PROMPT } from "./src/prompt.js";
import { buildSkillsSection } from "./src/skills.js";

export const APP_NAME = "Venice";
export const APP_AUTHOR = "Crazy Prince Dev";

export const DEFAULT_MODEL = "dphn/Dolphin-Mistral-24B-Venice-Edition";
export const DEFAULT_PROVIDER = "featherless-ai";
export const ROUTER_BASE_URL = "https://router.huggingface.co/v1";

// Température « normale » et budget de tokens au maximum : réglables via
// VENICE_TEMPERATURE / VENICE_MAX_TOKENS (ou HF_TEMPERATURE / HF_MAX_TOKENS).
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 100000;
export const MAX_TOKENS_LIMIT = 1000000;

/** Prompt système complet : identité de Venice + compétences. */
export const DEFAULT_SYSTEM_PROMPT = `${VENICE_PROMPT}\n\n# COMPÉTENCES\n\n${buildSkillsSection()}`;

function numberFrom(value, fallback, { min, max, integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (integer && !Number.isInteger(n)) return fallback;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}

export function getConfig(env = process.env) {
  const model = env.HF_MODEL || DEFAULT_MODEL;
  const provider = env.HF_PROVIDER || DEFAULT_PROVIDER;
  return {
    // La clé vient uniquement de l'environnement (Render/Vercel/local .env) :
    // jamais d'un fichier suivi par git.
    apiKey: env.HF_TOKEN || env.HF_API_KEY || "",
    model,
    provider,
    // Suffixe provider à la OpenAI : "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai"
    modelId: model.includes(":") ? model : `${model}:${provider}`,
    baseURL: env.HF_ROUTER_BASE_URL || ROUTER_BASE_URL, // surchargeable (tests/mock)
    timeoutMs: Number(env.HF_TIMEOUT_MS) > 0 ? Number(env.HF_TIMEOUT_MS) : 55_000,
    demoMode: /^(1|true|yes)$/i.test(env.DEMO_MODE || ""),
    // Réglages de génération (plus aucun contrôle côté navigateur).
    temperature: numberFrom(env.VENICE_TEMPERATURE ?? env.HF_TEMPERATURE, DEFAULT_TEMPERATURE, {
      min: 0,
      max: 2,
    }),
    maxTokens: numberFrom(env.VENICE_MAX_TOKENS ?? env.HF_MAX_TOKENS, DEFAULT_MAX_TOKENS, {
      min: 1,
      max: MAX_TOKENS_LIMIT,
      integer: true,
    }),
    systemPrompt: env.VENICE_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
  };
}
