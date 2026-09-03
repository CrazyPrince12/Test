// Fonction serverless Vercel — POST /api/chat
// Réutilise exactement la même logique que server.js (lib/httpChat.js),
// donc le comportement est identique sur Vercel, Render et en local.
//
// Variables d'environnement à définir dans Vercel (Project Settings →
// Environment Variables) : HF_API_KEY (obligatoire), HF_MODEL et
// HF_PROVIDER (optionnels).

import { handleChatHttp } from "../lib/httpChat.js";

export const config = {
  maxDuration: 60, // le streaming de réponse peut durer un moment
};

export default async function handler(req, res) {
  await handleChatHttp(req, res, process.env);
}
