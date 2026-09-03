# 🐬 Dolphin Chatbot

Chatbot web propulsé par **[dphn/Dolphin-Mistral-24B-Venice-Edition](https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition)** via les **Hugging Face Inference Providers** (provider : `featherless-ai`), implémenté avec le SDK JavaScript officiel [`@huggingface/inference`](https://huggingface.co/docs/huggingface.js/inference).

- **Déployable sur Vercel *et* Render** sans modification
- Clé API **côté serveur uniquement** — jamais exposée au navigateur
- **Streaming** des réponses (SSE) + mode non-stream
- Zéro framework côté serveur (Node natif) : démarrage instantané
- Mode **DÉMO** intégré : interface fonctionnelle hors-ligne (dev/preview)

## Ce que dit la fiche du modèle (appliqué ici)

| Recommandation | Implémentation |
|---|---|
| Provider d'inférence : **Featherless AI** | `HF_PROVIDER=featherless-ai` (défaut) |
| Température basse conseillée (**0.15**) | valeur par défaut + curseur dans l'UI |
| **Toujours définir un system prompt** (modèle « steerable ») | system prompt de la fiche pré-rempli, éditable ; injecté automatiquement si absent |
| API OpenAI-compatible via `router.huggingface.co` | `InferenceClient.chatCompletion{,Stream}` du SDK officiel |

## Structure

```
├── server.js          Serveur Node natif (statique + /api/chat + /api/health) → Render / local
├── api/chat.js        Fonction serverless → Vercel
├── lib/
│   ├── env.js         Chargeur .env zéro-dépendance
│   ├── config.js      Modèle, provider, défauts (temp 0.15…)
│   ├── messages.js    Validation + injection du system prompt
│   ├── dolphin.js     Appels SDK officiel + mapping d'erreurs + mode démo
│   └── httpChat.js    Couche HTTP/SSE partagée (Vercel = Render = local)
├── public/            Frontend (HTML/CSS/JS, sans build)
├── tests/             21 tests (node:test) + mock du router HF + test réel
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
npm test                  # 21 tests : unitaires + intégration HTTP (mock OpenAI-compatible)
npm run test:real         # appel RÉEL à l'API HF (nécessite Internet + clé chargée)
```

## Variables d'environnement

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `HF_API_KEY` | ✅ (prod) | — | Clé HF → https://huggingface.co/settings/tokens |
| `HF_MODEL` | | `dphn/Dolphin-Mistral-24B-Venice-Edition` | Modèle servi |
| `HF_PROVIDER` | | `featherless-ai` | Provider d'inférence |
| `HF_TIMEOUT_MS` | | `55000` | Timeout d'une génération |
| `DEMO_MODE` | | `0` | `1` = réponses simulées hors-ligne |
| `PORT` | | `3000` | Port (Render/Vercel le définissent eux-mêmes) |

## Déploiement — Vercel

1. Poussez le repo sur GitHub, puis **Import Project** sur [vercel.com](https://vercel.com/new)
   (aucune config de build nécessaire : `public/` est servi automatiquement et `api/chat.js` devient une fonction serverless).
2. **Settings → Environment Variables** : ajoutez `HF_API_KEY` = votre clé.
3. Deploy. Terminé — l'app est à la racine du domaine.

Ou en CLI : `vercel` puis `vercel env add HF_API_KEY`.

## Déploiement — Render

Option A (dashboard) : **New → Web Service** → connectez le repo →
- Runtime `Node`, Build `npm install`, Start `npm start`
- **Environment** : ajoutez `HF_API_KEY` = votre clé.

Option B (blueprint) : **New → Blueprint** → le fichier `render.yaml` configure tout
(`HF_API_KEY` est marquée `sync: false` : Render vous la demande, elle n'entre jamais dans le repo).

## Sécurité

- La clé vit dans `.env` (listé dans `.gitignore`) ou dans les variables chiffrées de l'hébergeur.
- Le navigateur n'appelle que `/api/chat` ; l'authentification HF est ajoutée côté serveur par le SDK.
- Les entrées sont validées (rôles, tailles, plages) et les erreurs du provider traduites en messages clairs.

## Dépannage

| Erreur affichée | Cause probable |
|---|---|
| « HF_API_KEY n'est pas configurée côté serveur » (500) | variable absente dans `.env` / dashboard |
| « Clé API Hugging Face invalide ou expirée » (401) | clé révoquée/fausse |
| « Crédits Hugging Face insuffisants… » (402) | plus de crédits Inference Providers → hf.co/settings/billing |
| « Limite de requêtes atteinte » (429) | rate limit, patienter |
| « Impossible de joindre l'API Hugging Face » (503) | réseau sortant bloqué (ex. sandbox restreint) |
