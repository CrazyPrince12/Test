// Configuration centralisée de Venice.
//
// Venice tourne sur le modèle dphn/Dolphin-Mistral-24B-Venice-Edition :
// https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition
//
// - Endpoint OpenAI-compatible indiqué par la fiche / la doc HF :
//   baseURL "https://router.huggingface.co/v1" et modèle avec suffixe provider
//   "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai".
// - La fiche insiste sur l'importance du system prompt (le modèle est
//   "steerable") : l'identité de Venice vient donc de src/prompt.js.
// - Les réglages de génération ne sont plus exposés dans l'interface :
//   ils se pilotent uniquement par variables d'environnement (.env).

import { VENICE_PROMPT } from "../src/prompt.js";
import { buildSkillsSection } from "../src/skills.js";

export const APP_NAME = "Venice";
export const APP_AUTHOR = "Crazy Prince Dev";

export const DEFAULT_MODEL = "dphn/Dolphin-Mistral-24B-Venice-Edition";
export const DEFAULT_PROVIDER = "featherless-ai";
export const ROUTER_BASE_URL = "https://router.huggingface.co/v1";

// Température « normale » et budget de tokens au maximum : réglables via
// VENICE_TEMPERATURE / VENICE_MAX_TOKENS (ou HF_TEMPERATURE / HF_MAX_TOKENS).
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 4096;
export const MAX_TOKENS_LIMIT = 8192;

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
