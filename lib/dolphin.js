// Client Dolphin : encapsule l'appel au modèle
// dphn/Dolphin-Mistral-24B-Venice-Edition via le SDK JavaScript officiel
// @huggingface/inference (voir https://huggingface.co/docs/huggingface.js/inference).
//
// L'inférence passe par les "Inference Providers" de Hugging Face
// (provider : featherless-ai, tel qu'indiqué sur la fiche du modèle).

import {
  InferenceClient,
  InferenceClientProviderApiError,
  InferenceClientHubApiError,
} from "@huggingface/inference";

/** Erreur normalisée renvoyée à la couche HTTP. */
export class DolphinError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = "DolphinError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Traduit les erreurs du SDK / du réseau / du provider en erreurs
 * lisibles (messages en français, statut HTTP conservé quand pertinent).
 */
export function mapProviderError(err) {
  if (err instanceof DolphinError) return err;

  // Erreurs HTTP renvoyées par le routeur HF ou le provider (Featherless).
  if (
    err instanceof InferenceClientProviderApiError ||
    err instanceof InferenceClientHubApiError ||
    (err && typeof err === "object" && err.httpResponse && typeof err.httpResponse.status === "number")
  ) {
    const status = err.httpResponse.status;
    let providerMsg = "";
    try {
      const body = err.httpResponse.body;
      providerMsg = typeof body === "string" ? body : JSON.stringify(body);
    } catch { /* ignore */ }

    const messages = {
      400: "Requête refusée par le provider d'inférence.",
      401: "Clé API Hugging Face invalide ou expirée. Vérifiez HF_API_KEY.",
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
    return new DolphinError(status, message, providerMsg?.slice(0, 300) || undefined);
  }

  // Timeout / annulation.
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new DolphinError(504, "Le modèle a mis trop de temps à répondre. Réessayez.");
  }

  // Erreurs réseau (DNS, TLS, connexion refusée…).
  const msg = String(err?.message ?? err ?? "");
  if (
    err?.name === "TypeError" ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|SSL|socket hang up|network/i.test(msg)
  ) {
    return new DolphinError(
      503,
      "Impossible de joindre l'API Hugging Face (réseau). Vérifiez la connectivité sortante du serveur.",
      msg.slice(0, 200)
    );
  }

  return new DolphinError(502, "Erreur inattendue lors de l'appel au modèle.", msg.slice(0, 200));
}

function makeClient(apiKey) {
  if (!apiKey) {
    throw new DolphinError(
      500,
      "HF_API_KEY n'est pas configurée côté serveur. Définissez-la dans .env (local) ou dans les variables d'environnement de l'hébergeur."
    );
  }
  return new InferenceClient(apiKey);
}

function buildArgs({ messages, temperature, maxTokens, model, provider }) {
  return {
    model,
    provider, // "featherless-ai" — provider indiqué sur la fiche du modèle
    messages,
    temperature,
    max_tokens: maxTokens,
  };
}

/**
 * Génération non-streamée. Renvoie { reply, usage, model }.
 * `extraOptions` permet d'injecter fetch/signal (utilisé par les tests).
 */
export async function generateReply(params, extraOptions = {}) {
  const client = params.client ?? makeClient(params.apiKey);
  try {
    const out = await client.chatCompletion(buildArgs(params), {
      retry_on_error: false,
      signal: params.signal,
      ...extraOptions,
    });
    const reply = out?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || reply.trim() === "") {
      throw new DolphinError(502, "Le provider a renvoyé une réponse vide ou mal formée.");
    }
    return { reply, usage: out?.usage ?? null, model: out?.model ?? params.model };
  } catch (err) {
    throw mapProviderError(err);
  }
}

/**
 * Génération streamée : générateur asynchrone qui produit les deltas de
 * texte au fur et à mesure.
 */
export async function* streamReply(params, extraOptions = {}) {
  const client = params.client ?? makeClient(params.apiKey);
  try {
    const stream = await client.chatCompletionStream(buildArgs(params), {
      retry_on_error: false,
      signal: params.signal,
      ...extraOptions,
    });
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

const DEMO_PREFIX = "🐬 [MODE DÉMO — aucune requête n'a été envoyée à Hugging Face]\n\n";

export function demoTextFrom(userText) {
  const excerpt = userText.length > 120 ? userText.slice(0, 120).trimEnd() + "…" : userText;
  return (
    DEMO_PREFIX +
    `Vous avez demandé : « ${excerpt} »\n\n` +
    "En mode normal, cette requête serait envoyée au modèle Dolphin Mistral 24B " +
    "Venice Edition via le router d'inférence Hugging Face (provider Featherless AI), " +
    "et sa réponse s'afficherait ici en streaming. Configurez HF_API_KEY et lancez " +
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
