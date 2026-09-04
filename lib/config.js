// Ré-export de la configuration centralisée.
//
// La source de vérité unique est désormais `config.js` (à la racine) :
// elle lit HF_TOKEN depuis les variables d'environnement injectées par
// l'hébergeur (Render/Vercel) ou depuis le `.env` local chargé par
// `lib/env.js` — jamais depuis un fichier suivi par git.
//
// Ce module est conservé pour la compatibilité des imports existants
// (`lib/httpChat.js`, `lib/messages.js`, tests…) : il ne fait que
// republier les symboles de `../config.js`.

export {
  APP_NAME,
  APP_AUTHOR,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  ROUTER_BASE_URL,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_LIMIT,
  DEFAULT_SYSTEM_PROMPT,
  getConfig,
} from "../config.js";
