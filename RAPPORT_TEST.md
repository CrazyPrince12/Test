# Rapport de test — Venice (par Crazy Prince Dev)

**Date :** 3 septembre 2026 · **Projet :** chatbot web pour `dphn/Dolphin-Mistral-24B-Venice-Edition`
**Implémentation :** SDK **OpenAI** avec la structure exacte de la fiche du modèle (`baseURL: https://router.huggingface.co/v1`, modèle `…:featherless-ai`)
**Verdict global : ✅ 21/21 tests automatisés passent · ✅ serveur + frontend validés en sandbox · ⚠️ appel réel HF impossible *depuis ce sandbox* (réseau filtré), code pourtant validé de bout en bout via un mock fidèle**

---

## 1. Sources de documentation utilisées

| Document | Ce qui en a été tiré |
|---|---|
| [Fiche du modèle](https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition) | Provider d'inférence = **Featherless AI** ; **température 0.15** recommandée ; **system prompt obligatoire** (modèle « steerable », exemple officiel fourni) ; `max_tokens=512` dans l'exemple officiel |
| Extrait OpenAI de la fiche (« Use this model ») | **Structure d'implémentation adoptée mot pour mot** : `new OpenAI({ baseURL: "https://router.huggingface.co/v1", apiKey: process.env.HF_TOKEN })` + `model: "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai"` |
| [Doc Inference Providers](https://huggingface.co/docs/inference-providers) | API OpenAI-compatible, routing provider via suffixe `:featherless-ai` |
| SDK installé (`openai@7.9.0`) | `client.chat.completions.create({…})` non-stream + `stream:true` (itérable asynchrone) ; erreurs `APIError` (`status` + `error.message`) ; options `timeout`/`maxRetries` |

## 2. Environnement sandbox

| Élément | Résultat |
|---|---|
| Node.js | v22.22.3 ✅ |
| npm registry | ✅ accessible (`openai@7.9.0` installé, 0 vulnérabilité) |
| `huggingface.co` / `router.huggingface.co` depuis le sandbox | ❌ **bloqués** (`ECONNRESET`, TLS interrompu) — sortie filtrée |
| GitHub | ✅ OK |

👉 L'appel réel HF **ne peut pas aboutir depuis ce sandbox**. La chaîne complète (SDK OpenAI → HTTP → SSE → parsing) a donc été validée contre un **mock strictement OpenAI-compatible**, puis le test réel est fourni (`npm run test:real`) pour être rejoué sur Render/Vercel/une machine connectée.

## 3. Résultats détaillés

### 3.1 Suite automatisée — `npm test` → **21/21 ✅** (~1,5 s)

| # | Test | Statut |
|---|---|---|
| 1–2 | Parseur `.env` (quotes, commentaires, `=` dans la valeur, fichier absent) | ✅ |
| 3 | Config : `modelId = "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai"` · `baseURL = router.huggingface.co/v1` · `HF_TOKEN` lu | ✅ |
| 4–5 | Validation requêtes (défauts 0.15/512 + 8 rejets : rôle, vide, tailles, plages…) | ✅ |
| 6 | System prompt : défaut injecté · explicite prioritaire · conversation respectée | ✅ |
| 7–8 | Mapping d'erreurs du SDK OpenAI : `APIError(402)` → « crédits » · réseau→503 · timeout→504 · inconnu→502 | ✅ |
| 9 | Client OpenAI configuré comme la fiche → `chat.completions.create` présent | ✅ |
| 10–12 | `generateReply` / `streamReply` avec client injecté + propagation d'erreurs | ✅ |
| 13 | **SDK OpenAI ↔ mock HTTP** : URL `/v1/chat/completions` · header `Authorization: Bearer hf_…` · body `model: "…:featherless-ai"`, `temperature: 0.15`, `max_tokens`, `stream:false`, system prompt en 1er message | ✅ |
| 14 | **SDK OpenAI ↔ mock HTTP** stream : tokens SSE rejoués dans l'ordre (`stream:true` → chunks parsés) | ✅ |
| 15 | Mauvaise clé → 401 remappée · `TRIGGER_402` → 402 « crédits insuffisants » | ✅ |
| 16 | `GET /` sert le HTML · `GET /style.css` bon MIME · 404 | ✅ |
| 17 | `/api/health` expose l'état **sans jamais inclure la clé** | ✅ |
| 18–19 | `POST /api/chat` démo : JSON `{demo:true}` + flux SSE complet (`started` → deltas → `[DONE]`) | ✅ |
| 20 | 405 GET · 400 rôle invalide · 400 JSON cassé · 500 sans clé (message clair) | ✅ |
| 21 | Traversée de répertoires bloquée (`/%2e%2e/package.json`) | ✅ |

### 3.2 Serveur en mode production (`.env` réel chargé, `DEMO_MODE` off) — sandbox

| Vérification | Résultat |
|---|---|
| Démarrage | ✅ `Venice écoute sur http://0.0.0.0:3001` — clé détectée |
| `GET /` | ✅ HTTP 200, `text/html` |
| `GET /api/health` | ✅ `{"ok":true, "model":"dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai", "keyConfigured":true, "defaults":{"temperature":0.15,"maxTokens":512}}` |
| `POST /api/chat` | ⚠️ HTTP **503** « Impossible de joindre l'API Hugging Face (réseau)… » detail `Connection error.` — **attendu dans ce sandbox** (HF bloqué). Ce chemin exact est validé en vert aux tests 13–15 contre le mock. |

### 3.3 Appel réel HF — `npm run test:real` (structure OpenAI de la fiche)

```json
"baseURL": "https://router.huggingface.co/v1",
"model": "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai",
"whoami":               { "ok": false, "networkError": "ECONNRESET" }
"chatCompletion":       { "ok": false, "status": 503, "detail": "Connection error." }
"chatCompletionStream": { "ok": false, "status": 503, "detail": "Connection error." }
```

➡️ Échec **uniquement réseau-sandbox** : aucune requête n'atteint HF depuis ici. À rejouer après déploiement (Render/Vercel) ou en local connecté — les 3 étapes doivent passer au vert.

### 3.4 Sécurité de la clé

| Contrôle | Résultat |
|---|---|
| `.env` créé avec la clé fournie (`HF_TOKEN` + alias `HF_API_KEY`) | ✅ usage local/test uniquement |
| `.env` dans `.gitignore` (`git check-ignore` vérifié) | ✅ |
| Clé dans un fichier suivi par git | ✅ **non** (`git ls-files \| grep` : 0 occurrence ; commit vérifié) |
| Clé exposée au navigateur | ✅ non — `/api/health` n'expose que `keyConfigured` |
| `.env.example` fourni sans secret | ✅ |

> ⚠️ **Recommandation : régénérez la clé** collée dans la conversation (https://huggingface.co/settings/tokens) — elle a été transmise en clair. Le projet n'a rien à changer : la nouvelle clé va dans votre `.env` / dashboard hébergeur.

### 3.5 Déployabilité

| Cible | Éléments fournis | Statut |
|---|---|---|
| **Vercel** | `api/chat.js` (serverless) + `public/` servi nativement + `vercel.json` | ✅ zéro-config ; ajouter `HF_TOKEN` dans le dashboard |
| **Render** | `server.js` (statique + API, `0.0.0.0:$PORT`) + `render.yaml` (`HF_TOKEN` en `sync:false`) | ✅ |
| Clé non commitée | `.gitignore` + double vérification §3.4 | ✅ |

## 4. Ajustements faits pendant les tests

1. `node --test tests/` refuse un dossier → script pointé sur le fichier de tests.
2. (Réécriture OpenAI) Client test injecté via `baseURL` du mock plutôt que redirection d'hôte — plus fidèle à la structure de la fiche qui reçoit déjà `baseURL` en paramètre.
3. `maxRetries: 0` côté client dans l'app et les tests → erreurs remontées immédiatement, mapping déterministe (mesuré : 401/402 correctement propagés).

## 5. Mode d'emploi rapide

```bash
npm install && npm start        # avec .env rempli → vrai modèle (structure OpenAI de la fiche)
npm run demo                    # hors-ligne : UI + streaming simulés
npm test                        # 21 tests
npm run test:real               # appel réel HF (à lancer avec Internet : Render/Vercel/local)
```

**Preview sandbox : lancée en `DEMO_MODE=1`** (HF bloqué ici) — interface complète manipulable ; le badge « mode démo » et le préfixe dans chaque réponse le signalent clairement.
