# 🐬 Rapport de test — Dolphin Chatbot

**Date :** 3 septembre 2026 · **Projet :** chatbot web pour `dphn/Dolphin-Mistral-24B-Venice-Edition`
**Verdict global : ✅ 21/21 tests automatisés passent · ✅ serveur + frontend validés en sandbox · ⚠️ appel réel HF impossible *depuis ce sandbox* (réseau), code pourtant validé de bout en bout via un mock fidèle**

---

## 1. Sources de documentation utilisées

| Document | Ce qui en a été tiré |
|---|---|
| [Fiche du modèle](https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition) | Provider d'inférence = **Featherless AI** ; **température 0.15** recommandée ; **system prompt obligatoire** (modèle « steerable », exemple officiel fourni) ; `max_tokens=512` dans l'exemple officiel ; 24B params → serverless obligatoire (60+ Go de GPU sinon) |
| [Doc JS @huggingface/inference](https://huggingface.co/docs/huggingface.js/inference) | `InferenceClient` + `chatCompletion` / `chatCompletionStream` avec paramètre `provider` ; erreurs typées (`InferenceClientProviderApiError`…) ; token **côté serveur** recommandé (proxy) |
| Source du SDK installé (v4.13.28) | Route via `router.huggingface.co` ; résolution préalable `GET huggingface.co/api/models/{id}?expand[]=inferenceProviderMapping` ; en-tête `Authorization` seulement si token `hf_*` |
| [Doc Inference Providers](https://huggingface.co/docs/inference-providers) | API OpenAI-compatible (`/v1/chat/completions`) |

## 2. Environnement sandbox

| Élément | Résultat |
|---|---|
| Node.js | v22.22.3 ✅ |
| npm registry (`registry.npmjs.org`) | ✅ accessible (SDK installé : `@huggingface/inference@4.13.28`, 0 vulnérabilité) |
| `huggingface.co` depuis le sandbox | ❌ **bloqué** (`ECONNRESET`, TLS interrompu) — sortie filtrée |
| `router.huggingface.co` depuis le sandbox | ❌ bloqué (idem) |
| GitHub | ✅ OK |

👉 Conséquence : l'appel réel à l'API HF **ne peut pas aboutir depuis ce sandbox**. La chaîne complète a donc été validée contre un **mock strictement OpenAI-compatible** (mêmes URL, mêmes en-têtes, SSE identique), et le test réel est fourni (`npm run test:real`) pour être rejoué sur Render/Vercel/une machine connectée.

## 3. Résultats détaillés

### 3.1 Suite automatisée — `npm test` → **21/21 ✅** (1,3 s)

| # | Test | Statut |
|---|---|---|
| 1–2 | Parseur `.env` (quotes, commentaires, `=` dans la valeur, fichier absent) | ✅ |
| 3 | Config par défaut = fiche du modèle (provider `featherless-ai`, temp `0.15`) | ✅ |
| 4 | Requête minimale valide + défauts appliqués | ✅ |
| 5 | 8 rejets de validation (rôle, vide, taille, plages, dernier message user) | ✅ |
| 6 | System prompt : défaut injecté · explicite prioritaire · conversation respectée | ✅ |
| 7–8 | Mapping d'erreurs : 402 « crédits » · réseau→503 · timeout→504 · inconnu→502 | ✅ |
| 9 | SDK officiel instancié, `chatCompletion`/`chatCompletionStream` présents | ✅ |
| 10–12 | `generateReply`/`streamReply` avec client injecté + propagation d'erreurs | ✅ |
| 13 | **SDK ↔ mock HTTP** non-stream : URL router, `Authorization: Bearer hf_…`, `temperature=0.15`, `max_tokens`, system prompt transmis | ✅ |
| 14 | **SDK ↔ mock HTTP** stream : tokens SSE rejoués dans l'ordre | ✅ |
| 15 | Mauvaise clé → 401 remappée · `TRIGGER_402` → 402 « crédits insuffisants » | ✅ |
| 16 | `GET /` sert le HTML · `GET /style.css` bon MIME · 404 | ✅ |
| 17 | `/api/health` expose l'état **sans jamais inclure la clé** | ✅ |
| 18 | `POST /api/chat` démo non-stream → JSON `{demo:true, reply}` | ✅ |
| 19 | `POST /api/chat` démo stream → flux SSE complet (`started` → deltas → `[DONE]`) | ✅ |
| 20 | 405 GET · 400 rôle invalide · 400 JSON cassé · 500 sans clé (message clair) | ✅ |
| 21 | Traversée de répertoires bloquée (`/%2e%2e/package.json`) | ✅ |

### 3.2 Serveur en mode production (`.env` réel chargé) — sandbox

| Vérification | Résultat |
|---|---|
| Démarrage | ✅ `🐬 Dolphin Chatbot écoute sur http://0.0.0.0:3000` — clé détectée, `DEMO_MODE` off |
| `GET /` | ✅ HTTP 200, `text/html`, 4 268 octets |
| `GET /api/health` | ✅ `{ok:true, keyConfigured:true, provider:"featherless-ai", defaults:{temperature:0.15, maxTokens:512}}` |
| `POST /api/chat` | ⚠️ HTTP **503** « Impossible de joindre l'API Hugging Face (réseau) » — **comportement attendu dans ce sandbox** (sortie HF bloquée). Le même code passe le test 13/14/15 contre le mock. |

### 3.3 Appel réel HF — `npm run test:real`

```json
"whoami":               { "ok": false, "networkError": "ECONNRESET" }
"chatCompletion":       { "ok": false, "status": 503, "message": "Impossible de joindre l'API Hugging Face (réseau)…" }
"chatCompletionStream": { "ok": false, "status": 503, "message": "…" }
```

➡️ L'échec est **uniquement réseau-sandbox** (aucune requête n'atteint HF). À rejouer sur Render/Vercel/in local connecté : les trois étapes doivent alors passer au vert.

### 3.4 Sécurité de la clé

| Contrôle | Résultat |
|---|---|
| `.env` créé avec la clé fournie | ✅ (usage local/test uniquement) |
| `.env` dans `.gitignore` | ✅ `git check-ignore` le confirme |
| Clé présente dans un fichier suivi par git | ✅ **non** — `git ls-files \| grep` : aucun |
| Clé exposée au navigateur | ✅ non — jamais envoyée front ; `/api/health` n'inclut que `keyConfigured` |
| `.env.example` fourni sans secret | ✅ |

> ⚠️ **Recommandation : la clé collée dans cette conversation devrait être régénérée** (révoquez-la sur https://huggingface.co/settings/tokens puis créez-en une nouvelle), car elle a été transmise en clair. Le projet n'en a pas besoin d'être changé : votre nouvelle clé ira dans `.env` / les variables d'hébergeur.

### 3.5 Déployabilité

| Cible | Éléments fournis | Statut |
|---|---|---|
| **Vercel** | `api/chat.js` (serverless) + `public/` servi nativement + `vercel.json` (maxDuration 60 s sur la fonction) | ✅ zéro-config, reste à ajouter `HF_API_KEY` dans le dashboard |
| **Render** | `server.js` (statique + API, écoute `0.0.0.0:$PORT`) + `render.yaml` (blueprint, `HF_API_KEY` en `sync:false`) | ✅ |
| Respect consigne « pas de clé commitée » | `.gitignore` + vérifications §3.4 | ✅ |

## 4. Bugs trouvés et corrigés pendant les tests

1. `node --test tests/` refuse un dossier → script pointé sur le fichier de tests.
2. Le SDK fait un **appel Hub préalable** (`/api/models?expand[]=inferenceProviderMapping`) avant le POST → mock enrichi pour répondre à cet endpoint.
3. Le SDK n'envoie `Authorization` au Hub que pour les tokens `hf_*` → clé de test passée au format réel (`hf_testkey…`) : les 3 derniers tests sont alors passés au vert.

## 5. Mode d'emploi rapide

```bash
npm install && npm start        # avec .env rempli → vrai modèle
npm run demo                    # hors-ligne : UI + streaming simulés (prévisualisation)
npm test                        # 21 tests
npm run test:real               # à lancer avec Internet (Render/Vercel/local connecté)
```

**Preview sandbox : lancée en `DEMO_MODE=1`** (le réseau HF étant bloqué ici) — l'interface complète est manipulable, le badge « mode démo » et le bandeau dans chaque réponse le signalent clairement.
