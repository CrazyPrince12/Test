# Venice

**Venice** — chatbot web créé par **Crazy Prince Dev**, propulsé par **[dphn/Dolphin-Mistral-24B-Venice-Edition](https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition)** via les **Hugging Face Inference Providers** (provider : `featherless-ai`), implémenté avec le **SDK OpenAI** et la structure exacte de la fiche du modèle :

```js
import { OpenAI } from "openai";

const client = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HF_TOKEN,
});

const chatCompletion = await client.chat.completions.create({
  model: "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai",
  messages: [{ role: "user", content: "What is the capital of France?" }],
});
```

- Interface **100 % chat** : le site s'ouvre directement sur la conversation
- Message d'accueil **adapté à l'heure**, bouton **effacer**, animation de **typing**, badge **« connecté »**
- Réponses **reformatées** (titres, listes, tableaux, blocs de code) et affichées en entier
- Icônes **SVG** uniquement (aucun emoji), animations **GSAP**, palette « faune et flore marines »
- Clé API **côté serveur uniquement** — jamais exposée au navigateur
- **Streaming** des réponses (SSE) + mode non-stream
- **Déployable sur Vercel *et* Render** sans modification, zéro framework serveur

## Identité de Venice

Le comportement du bot est défini côté serveur, jamais dans le navigateur :

- `src/prompt.js` — identité et instructions système (« Tu t'appelles Venice, créée par Crazy Prince Dev »)
- `src/skills.js` — connaissances additionnelles injectées dans le prompt système

La fiche du modèle insiste sur ce point : le modèle est *steerable*, c'est le
system prompt qui définit l'assistant. Il est injecté automatiquement à chaque
requête.

## Structure

```
├── server.js          Serveur Node natif (statique + /api/chat + /api/health) → Render / local
├── api/chat.js        Fonction serverless → Vercel
├── src/
│   ├── prompt.js      Identité et instructions système de Venice
│   └── skills.js      Compétences injectées dans le prompt système
├── lib/
│   ├── env.js         Chargeur .env zéro-dépendance
│   ├── config.js      Modèle, provider, défauts de génération (.env)
│   ├── messages.js    Validation + injection du system prompt
│   ├── venice.js      Client OpenAI (structure de la fiche) + mapping d'erreurs + mode démo
│   └── httpChat.js    Couche HTTP/SSE partagée (Vercel = Render = local)
├── public/
│   ├── index.html     Interface (chat uniquement)
│   ├── style.css      Thème « grands fonds » (bleus, turquoise, écume)
│   ├── app.js         Logique du chat + animations GSAP
│   ├── markdown.js    Reformatage des réponses (Markdown → DOM, sans innerHTML)
│   ├── ui-utils.js    Icônes SVG + presse-papiers
│   ├── assets/        Logo dauphin, drapeau du Cameroun (SVG)
│   └── vendor/        GSAP (servi localement, aucune dépendance CDN)
├── tests/             31 tests (node:test) : API, serveur, rendu des réponses
├── render.yaml        Blueprint Render
└── vercel.json        Config Vercel
```

## Lancer en local

```bash
npm install
cp .env.example .env      # puis collez votre clé dans HF_TOKEN
npm start                 # → http://localhost:3000
```

Sans clé ni réseau HF (interface seulement, réponses simulées) :

```bash
npm run demo              # DEMO_MODE=1
```

Tests :

```bash
npm test                  # 31 tests : unitaires + intégration HTTP + rendu des réponses
npm run test:real         # appel RÉEL à l'API HF (nécessite Internet + clé chargée)
```

## Variables d'environnement

Les réglages du modèle ne sont plus exposés dans l'interface : tout se règle ici.

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `HF_TOKEN` | oui (prod) | — | Clé HF → https://huggingface.co/settings/tokens (`HF_API_KEY` accepté aussi) |
| `HF_MODEL` | | `dphn/Dolphin-Mistral-24B-Venice-Edition` | Modèle servi |
| `HF_PROVIDER` | | `featherless-ai` | Provider → suffixe `:featherless-ai` |
| `HF_TEMPERATURE` | | `0.7` | Température (normale) |
| `HF_MAX_TOKENS` | | `4096` | Longueur maximale d'une réponse (plafond du provider) |
| `SYSTEM_PROMPT` | | `src/prompt.js` | Remplace le prompt système de Venice |
| `HF_TIMEOUT_MS` | | `55000` | Timeout d'une génération |
| `DEMO_MODE` | | `0` | `1` = réponses simulées hors-ligne |
| `PORT` | | `3000` | Port (Render/Vercel le définissent eux-mêmes) |

## Déploiement — Vercel

1. Poussez le repo sur GitHub, puis **Import Project** sur [vercel.com](https://vercel.com/new)
   (aucune config de build : `public/` est servi automatiquement et `api/chat.js` devient une fonction serverless).
2. **Settings → Environment Variables** : ajoutez `HF_TOKEN` = votre clé.
3. Deploy.

Ou en CLI : `vercel` puis `vercel env add HF_TOKEN`.

## Déploiement — Render

Option A (dashboard) : **New → Web Service** → connectez le repo →
- Runtime `Node`, Build `npm install`, Start `npm start`
- **Environment** : ajoutez `HF_TOKEN` = votre clé.

Option B (blueprint) : **New → Blueprint** → `render.yaml` configure tout
(`HF_TOKEN` est marquée `sync: false` : Render vous la demande).

## Sécurité

- La clé vit dans `.env` ou dans les variables chiffrées de l'hébergeur.
- Le navigateur n'appelle que `/api/chat` ; l'authentification HF est ajoutée côté serveur.
- Les réponses du modèle sont rendues via `createElement`/`textContent` — jamais `innerHTML` : aucun HTML du modèle n'est interprété.
- Les entrées sont validées (rôles, tailles, plages) et les erreurs du provider traduites en messages clairs.

## Dépannage

| Erreur affichée | Cause probable |
|---|---|
| « HF_TOKEN (ou HF_API_KEY) n'est pas configurée côté serveur » (500) | variable absente dans `.env` / dashboard |
| « Clé API Hugging Face invalide ou expirée » (401) | clé révoquée/fausse |
| « Crédits Hugging Face insuffisants… » (402) | plus de crédits Inference Providers → hf.co/settings/billing |
| « Limite de requêtes atteinte » (429) | rate limit, patienter |
| « Impossible de joindre l'API Hugging Face » (503) | réseau sortant bloqué (ex. sandbox restreint) |

## Crédits

- Icône du dauphin : [Game Icons](https://game-icons.net) — licence CC BY 3.0.
- Animations : [GSAP](https://gsap.com) (servi depuis `public/vendor/`).
- Venice est créée par **Crazy Prince Dev** — From Cameroun.
