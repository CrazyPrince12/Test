// Configuration centralisée.
//
// Modèle servi : dphn/Dolphin-Mistral-24B-Venice-Edition
// (https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition) exposé
// dans l'interface sous le nom du produit : Venice.
//
// - Endpoint OpenAI-compatible indiqué par la fiche / la doc HF :
//   baseURL "https://router.huggingface.co/v1" et modèle avec suffixe provider
//   "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai".
// - La fiche insiste sur l'importance du system prompt (le modèle est
//   "steerable") : c'est src/prompt.js + src/skills.js qui définissent Venice.
//
// Les réglages de génération ne sont PLUS exposés dans l'interface : ils
// vivent uniquement ici et dans le .env (HF_TEMPERATURE, HF_MAX_TOKENS).

import { VENICE_PROMPT } from "../src/prompt.js";
import { buildSkillsSection } from "../src/skills.js";

export const DEFAULT_MODEL = "dphn/Dolphin-Mistral-24B-Venice-Edition";
export const DEFAULT_PROVIDER = "featherless-ai";
export const ROUTER_BASE_URL = "https://router.huggingface.co/v1";

/** Température « normale » (réglable via HF_TEMPERATURE). */
export const DEFAULT_TEMPERATURE = 0.7;
/** Plafond de génération accepté : on demande le maximum par défaut
 *  ("tokens illimités" côté utilisateur), réglable via HF_MAX_TOKENS. */
export const MAX_TOKENS_LIMIT = 4096;
export const DEFAULT_MAX_TOKENS = MAX_TOKENS_LIMIT;

/** Prompt système complet : identité Venice + compétences. */
export const DEFAULT_SYSTEM_PROMPT = `${VENICE_PROMPT}\n\n# COMPÉTENCES\n\n${buildSkillsSection()}`;

/**
 * Valeurs par défaut de génération, lues dans l'environnement AU MOMENT DE
 * L'APPEL (le .env est chargé après l'import des modules).
 */
export function getDefaults(env = process.env) {
  const rawTemp = Number(env.HF_TEMPERATURE);
  const temperature =
    Number.isFinite(rawTemp) && rawTemp >= 0 && rawTemp <= 2 ? rawTemp : DEFAULT_TEMPERATURE;

  const rawMax = Number(env.HF_MAX_TOKENS);
  const maxTokens =
    Number.isInteger(rawMax) && rawMax >= 1 && rawMax <= MAX_TOKENS_LIMIT
      ? rawMax
      : DEFAULT_MAX_TOKENS;

  const systemPrompt =
    typeof env.SYSTEM_PROMPT === "string" && env.SYSTEM_PROMPT.trim()
      ? env.SYSTEM_PROMPT.trim()
      : DEFAULT_SYSTEM_PROMPT;

  return { temperature, maxTokens, systemPrompt };
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
    ...getDefaults(env),
  };
}
