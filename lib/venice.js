// Client Venice : encapsule l'appel au modèle
// dphn/Dolphin-Mistral-24B-Venice-Edition via le SDK OpenAI, en suivant
// exactement la structure fournie par la fiche Hugging Face du modèle :
//
//   import { OpenAI } from "openai";
//   const client = new OpenAI({
//     baseURL: "https://router.huggingface.co/v1",
//     apiKey: process.env.HF_TOKEN,
//   });
//   const chatCompletion = await client.chat.completions.create({
//     model: "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai",
//     messages: [ ... ],
//   });
//
// Référence : https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition
// (onglet "Use this model" → extrait OpenAI / Inference Providers).

import OpenAI from "openai";

/** Erreur normalisée renvoyée à la couche HTTP. */
export class VeniceError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = "VeniceError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Traduit les erreurs du SDK OpenAI / du réseau / du provider en erreurs
 * lisibles (messages en français, statut HTTP conservé quand pertinent).
 */
export function mapProviderError(err) {
  if (err instanceof VeniceError) return err;

  // Erreurs HTTP du router HF / du provider (APIError du SDK OpenAI :
  // err.status + err.error.{message,type,code}).
  if (err && typeof err.status === "number") {
    const status = err.status;
    const providerMsg =
      (err.error && typeof err.error === "object" ? err.error.message : null) ??
      (typeof err.error === "string" ? err.error : null) ??
      err.message;

    const messages = {
      400: "Requête refusée par le provider d'inférence.",
      401: "Clé API Hugging Face invalide ou expirée. Vérifiez HF_TOKEN.",
      403: "Accès refusé : la clé n'a pas la permission d'utiliser les Inference Providers.",
      402: "Crédits Hugging Face insuffisants pour ce provider (Featherless AI). Rechargez votre compte sur hf.co/settings/billing.",
      404: "Modèle introuvable ou non disponible chez ce provider pour le moment.",
      409: "Conflit côté provider d'inférence.",
      422: "Paramètres de génération refusés par le provider.",
      429: "Limite de requêtes atteinte (rate limit). Réessayez dans un instant.",
    };
    const message = messages[status] ??
      (status >= 500
        ? "Le provider d'inférence rencontre une erreur. Réessayez dans un instant."
        : `Erreur du provider d'inférence (HTTP ${status}).`);
    return new VeniceError(status, message, String(providerMsg ?? "").slice(0, 300) || undefined);
  }

  // Timeout / annulation.
  if (
    err?.name === "APIConnectionTimeoutError" ||
    err?.name === "TimeoutError" ||
    err?.name === "AbortError"
  ) {
    return new VeniceError(504, "Le modèle a mis trop de temps à répondre. Réessayez.");
  }

  // Erreurs réseau (DNS, TLS, connexion refusée…).
  const msg = String(err?.message ?? err ?? "");
  if (
    err?.name === "APIConnectionError" ||
    err?.name === "TypeError" ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|SSL|socket hang up|network|Connection error/i.test(msg)
  ) {
    return new VeniceError(
      503,
      "Impossible de joindre l'API Hugging Face (réseau). Vérifiez la connectivité sortante du serveur.",
      msg.slice(0, 200)
    );
  }

  return new VeniceError(502, "Erreur inattendue lors de l'appel au modèle.", msg.slice(0, 200));
}

/**
 * Fabrique le client OpenAI pointé sur le router Hugging Face
 * (structure exacte de la fiche du modèle).
 */
export function makeClient({ apiKey, baseURL, timeoutMs }) {
  if (!apiKey) {
    throw new VeniceError(
      500,
      "HF_TOKEN (ou HF_API_KEY) n'est pas configurée côté serveur. Définissez-la dans .env (local) ou dans les variables d'environnement de l'hébergeur."
    );
  }
  return new OpenAI({
    baseURL, // "https://router.huggingface.co/v1"
    apiKey, // process.env.HF_TOKEN
    timeout: timeoutMs,
    maxRetries: 0, // retries gérés explicitement côté application
  });
}

function buildArgs(params) {
  return {
    model: params.modelId, // "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai"
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    stream: false,
  };
}

/**
 * Génération non-streamée. Renvoie { reply, usage, model }.
 * `params.client` permet d'injecter un client (tests) ;
 * `extraOptions` est passé en RequestOptions (signal, fetch…).
 */
export async function generateReply(params, extraOptions = {}) {
  const client = params.client ?? makeClient(params);
  try {
    const chatCompletion = await client.chat.completions.create(buildArgs(params), {
      signal: params.signal,
      ...extraOptions,
    });
    const reply = chatCompletion?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || reply.trim() === "") {
      throw new VeniceError(502, "Le provider a renvoyé une réponse vide ou mal formée.");
    }
    return {
      reply,
      usage: chatCompletion?.usage ?? null,
      model: chatCompletion?.model ?? params.modelId,
    };
  } catch (err) {
    throw mapProviderError(err);
  }
}

/**
 * Génération streamée : client.chat.completions.create({ ..., stream: true })
 * renvoie un itérable asynchrone de chunks OpenAI ; on produit les deltas.
 */
export async function* streamReply(params, extraOptions = {}) {
  const client = params.client ?? makeClient(params);
  try {
    const stream = await client.chat.completions.create(
      { ...buildArgs(params), stream: true },
      { signal: params.signal, ...extraOptions }
    );
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) yield delta;
    }
  } catch (err) {
    throw mapProviderError(err);
  }
}

// ---------------------------------------------------------------------------
// Mode DÉMO : réponses simulées localement, sans appel réseau. Sert à
// développer/prévisualiser l'interface quand le sandbox n'a pas accès à
// huggingface.co. Claironné dans l'UI et dans les réponses.
// ---------------------------------------------------------------------------

const DEMO_PREFIX = "[MODE DÉMO — aucune requête n'a été envoyée à Hugging Face]\n\n";

export function demoTextFrom(userText) {
  const excerpt = userText.length > 120 ? userText.slice(0, 120).trimEnd() + "…" : userText;
  return (
    DEMO_PREFIX +
    `Vous avez demandé : « ${excerpt} »\n\n` +
    "En mode normal, Venice enverrait cette requête au modèle via le router " +
    "d'inférence Hugging Face (provider Featherless AI), " +
    "et sa réponse s'afficherait ici en streaming. Configurez HF_TOKEN et lancez " +
    "le serveur avec un accès Internet à huggingface.co pour utiliser le vrai modèle."
  );
}

export async function* demoStream(userText) {
  const full = demoTextFrom(userText);
  const words = full.split(/(?<= )/); // découpe en "mots" avec espaces conservées
  for (const w of words) {
    yield w;
    await new Promise((r) => setTimeout(r, 15)); // petit effet de streaming
  }
}
