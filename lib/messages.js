// Validation et préparation des requêtes de chat.

import { MAX_TOKENS_LIMIT, getDefaults } from "./config.js";

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

const ROLES = new Set(["system", "user", "assistant"]);
const MAX_MESSAGES = 41; // system + 20 échanges max
const MAX_MESSAGE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 60_000;
const MAX_SYSTEM_PROMPT_CHARS = 4_000;

/**
 * Valide le corps JSON d'une requête POST /api/chat et renvoie une
 * version assainie. Lève ValidationError (status 400) si invalide.
 */
export function validateChatPayload(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Le corps de la requête doit être un objet JSON.");
  }

  const { messages, temperature, max_tokens, maxTokens, stream, systemPrompt } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ValidationError('"messages" doit être un tableau non vide.');
  }
  if (messages.length > MAX_MESSAGES) {
    throw new ValidationError(`Trop de messages (max ${MAX_MESSAGES}).`);
  }

  let total = 0;
  const cleanMessages = messages.map((m, i) => {
    if (m === null || typeof m !== "object") {
      throw new ValidationError(`Message n°${i + 1} invalide.`);
    }
    if (!ROLES.has(m.role)) {
      throw new ValidationError(
        `Message n°${i + 1} : rôle invalide ("system", "user" ou "assistant" attendu).`
      );
    }
    if (typeof m.content !== "string" || m.content.trim() === "") {
      throw new ValidationError(`Message n°${i + 1} : contenu vide.`);
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      throw new ValidationError(
        `Message n°${i + 1} : trop long (max ${MAX_MESSAGE_CHARS} caractères).`
      );
    }
    total += m.content.length;
    return { role: m.role, content: m.content };
  });
  if (total > MAX_TOTAL_CHARS) {
    throw new ValidationError(`Conversation trop longue (max ${MAX_TOTAL_CHARS} caractères).`);
  }
  if (cleanMessages[cleanMessages.length - 1].role !== "user") {
    throw new ValidationError("Le dernier message doit venir de l'utilisateur.");
  }

  const defaults = getDefaults();

  let cleanTemperature = temperature === undefined ? defaults.temperature : temperature;
  if (typeof cleanTemperature !== "number" || Number.isNaN(cleanTemperature) ||
      cleanTemperature < 0 || cleanTemperature > 2) {
    throw new ValidationError('"temperature" doit être un nombre entre 0 et 2.');
  }

  const rawMax = max_tokens ?? maxTokens;
  let cleanMaxTokens = rawMax === undefined ? defaults.maxTokens : rawMax;
  if (!Number.isInteger(cleanMaxTokens) || cleanMaxTokens < 1 || cleanMaxTokens > MAX_TOKENS_LIMIT) {
    throw new ValidationError(`"max_tokens" doit être un entier entre 1 et ${MAX_TOKENS_LIMIT}.`);
  }

  let cleanSystemPrompt;
  if (systemPrompt !== undefined) {
    if (typeof systemPrompt !== "string") {
      throw new ValidationError('"systemPrompt" doit être une chaîne.');
    }
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
      throw new ValidationError(
        `"systemPrompt" trop long (max ${MAX_SYSTEM_PROMPT_CHARS} caractères).`
      );
    }
    cleanSystemPrompt = systemPrompt.trim() || undefined;
  }

  return {
    messages: cleanMessages,
    temperature: cleanTemperature,
    maxTokens: cleanMaxTokens,
    stream: stream === true,
    systemPrompt: cleanSystemPrompt,
  };
}

/**
 * Applique la règle de la fiche du modèle : un system prompt doit TOUJOURS
 * être présent. Priorité : systemPrompt explicite > system message de la
 * conversation > prompt système de Venice (src/prompt.js + src/skills.js).
 */
export function applySystemPrompt(payload) {
  const messages = payload.messages.filter((m) => m.role !== "system");
  const system =
    payload.systemPrompt ??
    payload.messages.find((m) => m.role === "system")?.content ??
    getDefaults().systemPrompt;
  return [{ role: "system", content: system }, ...messages];
}
