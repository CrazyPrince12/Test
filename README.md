# Venice

**Venice** — chatbot web créé par **Crazy Prince Dev**. Interface unique : le chat, rien d'autre.

Propulsé par **[dphn/Dolphin-Mistral-24B-Venice-Edition](https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition)** via les **Hugging Face Inference Providers** (provider : `featherless-ai`), implémenté avec le **SDK OpenAI** et la structure exacte de la fiche du modèle :

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

- Interface **Venice** : chat plein écran, thème « faune marine », animations GSAP, icônes SVG (aucun emoji)
- Réponses **mises en forme** (titres, listes, code, tableaux) et affichées en entier
- Bouton **Effacer** pour repartir de zéro, badge d'état **connecté**, accueil selon l'heure
- **Déployable sur Vercel *et* Render** sans modification
- Clé API **côté serveur uniquement** — jamais exposée au navigateur
- **Streaming** des réponses (SSE) + mode non-stream
- Zéro framework côté serveur (Node natif) : démarrage instantané
- Mode **DÉMO** intégré : interface fonctionnelle hors-ligne (dev/preview)

## Ce que dit la fiche du modèle (appliqué ici)

| Recommandation | Implémentation |
|---|---|
| Extrait OpenAI : `baseURL: "https://router.huggingface.co/v1"` + `HF_TOKEN` | `lib/venice.js` (`new OpenAI({ baseURL, apiKey })`) |
| Modèle avec suffixe `:featherless-ai` | construit depuis `HF_MODEL` + `HF_PROVIDER` |
| Réglages de génération | pilotés **uniquement par le `.env`** (`VENICE_TEMPERATURE`, `VENICE_MAX_TOKENS`) — aucun panneau de réglages dans l'interface |
| **Toujours définir un system prompt** (modèle « steerable ») | identité de Venice dans `src/prompt.js` + `src/skills.js`, injectée automatiquement côté serveur |

## Structure

```
├── server.js          Serveur Node natif (statique + /api/chat + /api/health) → Render / local
├── api/chat.js        Fonction serverless → Vercel
├── lib/
│   ├── env.js         Chargeur .env zéro-dépendance
│   ├── config.js      Modèle, provider, réglages issus du .env
│   ├── messages.js    Validation + injection du system prompt
│   ├── venice.js      Client OpenAI (structure de la fiche) + mapping d'erreurs + mode démo
│   └── httpChat.js    Couche HTTP/SSE partagée (Vercel = Render = local)
├── src/
│   ├── prompt.js      Identité et instructions système de Venice
│   └── skills.js      Compétences injectées dans le prompt système
├── public/            Frontend Venice (HTML/CSS/JS + assets SVG, sans build)
├── tests/             22 tests (node:test) + mock du router HF + test réel
├── render.yaml        Blueprint Render
└── vercel.json        Config Vercel
```

## Lancer en local

```bash
npm install
cp .env.example .env      # puis collez votre clé HF_API_KEY dans .env
npm start                 # → http://localhost:3000
```

Sans clé ni réseau HF (interface seulement, réponses simulées) :

```bash
npm run demo              # DEMO_MODE=1
```

Tests :

```bash
npm test                  # 22 tests : unitaires + intégration HTTP (mock OpenAI-compatible)
npm run test:real         # appel RÉEL à l'API HF (nécessite Internet + clé chargée)
```

## Variables d'environnement

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `HF_TOKEN` | ✅ (prod) | — | Clé HF → https://huggingface.co/settings/tokens (`HF_API_KEY` accepté aussi) |
| `HF_MODEL` | | `dphn/Dolphin-Mistral-24B-Venice-Edition` | Modèle servi |
| `HF_PROVIDER` | | `featherless-ai` | Provider → suffixe `:featherless-ai` |
| `VENICE_TEMPERATURE` | | `0.7` | Température (0 → 2) |
| `VENICE_MAX_TOKENS` | | `4096` | Tokens max par réponse (1 → 8192) |
| `VENICE_SYSTEM_PROMPT` | | `src/prompt.js` | Remplace le prompt système |
| `HF_TIMEOUT_MS` | | `55000` | Timeout d'une génération |
| `DEMO_MODE` | | `0` | `1` = réponses simulées hors-ligne |
| `PORT` | | `3000` | Port (Render/Vercel le définissent eux-mêmes) |

## Déploiement — Vercel

1. Poussez le repo sur GitHub, puis **Import Project** sur [vercel.com](https://vercel.com/new)
   (aucune config de build nécessaire : `public/` est servi automatiquement et `api/chat.js` devient une fonction serverless).
2. **Settings → Environment Variables** : ajoutez `HF_TOKEN` = votre clé.
3. Deploy. Terminé — l'app est à la racine du domaine.

Ou en CLI : `vercel` puis `vercel env add HF_TOKEN`.

## Déploiement — Render

Option A (dashboard) : **New → Web Service** → connectez le repo →
- Runtime `Node`, Build `npm install`, Start `npm start`
- **Environment** : ajoutez `HF_TOKEN` = votre clé.

Option B (blueprint) : **New → Blueprint** → le fichier `render.yaml` configure tout
(`HF_TOKEN` est marquée `sync: false` : Render vous la demande, elle n'entre jamais dans le repo).

## Sécurité

- La clé vit dans `.env` (listé dans `.gitignore`) ou dans les variables chiffrées de l'hébergeur.
- Le navigateur n'appelle que `/api/chat` ; l'authentification HF est ajoutée côté serveur par le SDK.
- Les entrées sont validées (rôles, tailles, plages) et les erreurs du provider traduites en messages clairs.

## Dépannage

| Erreur affichée | Cause probable |
|---|---|
| « HF_TOKEN (ou HF_API_KEY) n'est pas configurée côté serveur » (500) | variable absente dans `.env` / dashboard |
| « Clé API Hugging Face invalide ou expirée » (401) | clé révoquée/fausse |
| « Crédits Hugging Face insuffisants… » (402) | plus de crédits Inference Providers → hf.co/settings/billing |
| « Limite de requêtes atteinte » (429) | rate limit, patienter |
| « Impossible de joindre l'API Hugging Face » (503) | réseau sortant bloqué (ex. sandbox restreint) |
