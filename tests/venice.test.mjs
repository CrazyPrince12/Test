import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { parseDotEnv, loadDotEnv } from "../lib/env.js";
import {
  getConfig,
  getDefaults,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
} from "../lib/config.js";
import { validateChatPayload, applySystemPrompt, ValidationError } from "../lib/messages.js";
import {
  VeniceError,
  mapProviderError,
  generateReply,
  streamReply,
  demoTextFrom,
} from "../lib/venice.js";
import OpenAI, { APIError } from "openai";
import { createApp } from "../server.js";
import { startMockRouter, MOCK_KEY } from "./mock-hf-server.mjs";

const OK_BODY = {
  messages: [{ role: "user", content: "Bonjour" }],
};

// ---------------------------------------------------------------- .env
test(".env : parseDotEnv gère commentaires, quotes et '=' dans la valeur", () => {
  const parsed = parseDotEnv(
    '# commentaire\nHF_API_KEY="abc=def"\nHF_MODEL=plain\nEMPTY=\n\n  bad line without equals\n'
  );
  assert.equal(parsed.HF_API_KEY, "abc=def");
  assert.equal(parsed.HF_MODEL, "plain");
  assert.equal(parsed.EMPTY, "");
  assert.ok(!("bad line" in parsed));
});

test(".env : loadDotEnv ne lève pas d'erreur si le fichier est absent", () => {
  assert.equal(loadDotEnv("/chemin/inexistant/.env"), false);
});

// ---------------------------------------------------------------- config
test("config : valeurs par défaut (modèle Venice, provider featherless)", () => {
  const cfg = getConfig({});
  assert.equal(cfg.provider, "featherless-ai");
  assert.equal(cfg.model, "dphn/Dolphin-Mistral-24B-Venice-Edition");
  // Suffixe provider à la OpenAI (structure de la fiche)
  assert.equal(cfg.modelId, "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai");
  assert.equal(cfg.baseURL, "https://router.huggingface.co/v1");
  assert.equal(cfg.apiKey, "");
  assert.equal(cfg.demoMode, false);
  assert.equal(getConfig({ DEMO_MODE: "1" }).demoMode, true);
  assert.equal(getConfig({ HF_TOKEN: "hf_x" }).apiKey, "hf_x");
});

// ---------------------------------------------------------------- validation
test("validation : requête minimale OK + défauts du serveur (température normale, tokens au max)", () => {
  const v = validateChatPayload(OK_BODY);
  assert.equal(v.temperature, DEFAULT_TEMPERATURE);
  assert.equal(v.maxTokens, DEFAULT_MAX_TOKENS);
  assert.equal(v.stream, false);
});

test("config : HF_TEMPERATURE / HF_MAX_TOKENS pilotent les défauts depuis le .env", () => {
  const d = getDefaults({ HF_TEMPERATURE: "0.3", HF_MAX_TOKENS: "1024" });
  assert.equal(d.temperature, 0.3);
  assert.equal(d.maxTokens, 1024);
  // Valeurs hors bornes ignorées → retour aux défauts.
  assert.equal(getDefaults({ HF_TEMPERATURE: "9" }).temperature, DEFAULT_TEMPERATURE);
  assert.equal(getDefaults({ HF_MAX_TOKENS: "999999" }).maxTokens, DEFAULT_MAX_TOKENS);
});

test("prompt : l'identité Venice (créée par Crazy Prince Dev) est dans le system prompt", () => {
  assert.match(DEFAULT_SYSTEM_PROMPT, /Tu t'appelles Venice/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /Crazy Prince Dev/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /COMPÉTENCES/);
});

test("validation : rejette les corps invalides", () => {
  assert.throws(() => validateChatPayload(null), ValidationError);
  assert.throws(() => validateChatPayload({}), ValidationError);
  assert.throws(() => validateChatPayload({ messages: [] }), ValidationError);
  assert.throws(
    () => validateChatPayload({ messages: [{ role: "hacker", content: "x" }] }),
    /rôle invalide/
  );
  assert.throws(
    () => validateChatPayload({ messages: [{ role: "user", content: "  " }] }),
    /contenu vide/
  );
  assert.throws(
    () =>
      validateChatPayload({
        messages: [{ role: "assistant", content: "réponse sans question" }],
      }),
    /l'utilisateur/
  );
  assert.throws(
    () => validateChatPayload({ ...OK_BODY, temperature: 99 }),
    /temperature/
  );
  assert.throws(
    () => validateChatPayload({ ...OK_BODY, max_tokens: 0 }),
    /max_tokens/
  );
  assert.throws(
    () =>
      validateChatPayload({
        messages: [{ role: "user", content: "x".repeat(8_001) }],
      }),
    /trop long/
  );
});

test("system prompt : défaut ajouté, explicite prioritaire, conversation respectée", () => {
  // 1. aucun system → défaut de la fiche
  let msgs = applySystemPrompt(validateChatPayload(OK_BODY));
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, DEFAULT_SYSTEM_PROMPT);

  // 2. systemPrompt explicite prioritaire
  msgs = applySystemPrompt(validateChatPayload({ ...OK_BODY, systemPrompt: "Sois un pirate." }));
  assert.equal(msgs[0].content, "Sois un pirate.");
  assert.equal(msgs.filter((m) => m.role === "system").length, 1);

  // 3. system déjà présent dans la conversation conservé
  msgs = applySystemPrompt(
    validateChatPayload({
      messages: [
        { role: "system", content: "Réponds en vers." },
        { role: "user", content: "Salut" },
      ],
    })
  );
  assert.equal(msgs[0].content, "Réponds en vers.");
});

// ---------------------------------------------------------------- erreurs
test("mapProviderError : 402 provider → statut + message crédits", () => {
  // APIError réelle du SDK OpenAI (forme renvoyée quand HF/Featherless répond 402)
  const err = new APIError(
    402,
    { message: "You have exceeded your monthly included credits." },
    "Payment required",
    new Headers()
  );
  const mapped = mapProviderError(err);
  assert.ok(mapped instanceof VeniceError);
  assert.equal(mapped.status, 402);
  assert.match(mapped.message, /[Cc]rédits/);
  assert.match(mapped.detail ?? "", /credits/);
});

test("mapProviderError : réseau → 503, timeout → 504, inconnu → 502", () => {
  assert.equal(mapProviderError(new TypeError("fetch failed")).status, 503);
  const t = new Error("trop lent");
  t.name = "TimeoutError";
  assert.equal(mapProviderError(t).status, 504);
  assert.equal(mapProviderError(new Error("bizarre")).status, 502);
});

// ---------------------------------------------------------------- SDK
test("SDK OpenAI : client configuré comme la fiche expose chat.completions.create", () => {
  const client = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: "hf_cle_factice",
    maxRetries: 0,
  });
  assert.equal(typeof client.chat.completions.create, "function");
});

test("dolphin : generateReply avec client injecté renvoie le texte", async () => {
  const client = {
    chat: {
      completions: {
        create: async () => ({
          model: "m",
          choices: [{ message: { content: "Réponse factice" } }],
          usage: { total_tokens: 1 },
        }),
      },
    },
  };
  const out = await generateReply({ client, messages: OK_BODY.messages, modelId: "m" });
  assert.equal(out.reply, "Réponse factice");
  assert.equal(out.usage.total_tokens, 1);
});

test("dolphin : generateReply remappe les erreurs du client", async () => {
  const client = {
    chat: {
      completions: {
        create: async () => {
          throw new TypeError("fetch failed");
        },
      },
    },
  };
  await assert.rejects(
    () => generateReply({ client, messages: OK_BODY.messages, modelId: "m" }),
    (e) => e instanceof VeniceError && e.status === 503
  );
});

test("dolphin : streamReply concatène les deltas", async () => {
  async function* chunks() {
    yield { choices: [{ delta: { content: "Bon" } }] };
    yield { choices: [{ delta: { content: "jour" } }] };
    yield { choices: [{ delta: {} }] };
  }
  const client = {
    chat: { completions: { create: async () => chunks() } },
  };
  let text = "";
  for await (const d of streamReply({ client, messages: OK_BODY.messages, modelId: "m" })) {
    text += d;
  }
  assert.equal(text, "Bonjour");
});

// ------------------------------------------- intégration SDK OpenAI ↔ mock router HTTP
let mock;
before(async () => {
  mock = await startMockRouter();
});
after(() => mock.server.close());

function mockClient(apiKey, calls) {
  // Structure identique à la fiche, avec baseURL pointé sur le mock (tests)
  // au lieu de "https://router.huggingface.co/v1".
  const options = {
    baseURL: `${mock.url}/v1`,
    apiKey,
    maxRetries: 0, // pas de retry pendant les tests
  };
  if (calls) {
    options.fetch = (url, init) => {
      calls.push({ url: String(url), init });
      return fetch(url, init);
    };
  }
  return new OpenAI(options);
}

test("SDK OpenAI + mock router : non-stream OK (payload complet conforme à la fiche)", async () => {
  const calls = [];
  const client = mockClient(MOCK_KEY, calls);
  const out = await generateReply({
    client,
    modelId: "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai",
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: "Ping réseau" },
    ],
    temperature: 0.15,
    maxTokens: 64,
  });
  assert.equal(out.reply, "MOCK-OK: Ping réseau");

  const post = calls.find((c) => c.url.includes("/v1/chat/completions"));
  assert.ok(post, "l'appel chat/completions doit avoir lieu");
  const sent = JSON.parse(post.init.body);
  const headers = post.init.headers;
  const auth =
    headers instanceof Headers
      ? headers.get("authorization")
      : headers.Authorization ?? headers.authorization ?? null;
  assert.equal(auth, `Bearer ${MOCK_KEY}`);
  assert.equal(sent.model, "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai");
  assert.equal(sent.temperature, 0.15);
  assert.equal(sent.max_tokens, 64);
  assert.equal(sent.stream, false);
  assert.equal(sent.messages[0].role, "system");
});

test("SDK OpenAI + mock router : stream OK, tokens dans l'ordre", async () => {
  const client = mockClient(MOCK_KEY);
  let text = "";
  for await (const d of streamReply({
    client,
    modelId: "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai",
    messages: [{ role: "user", content: "Un deux trois" }],
    temperature: 0.15,
    maxTokens: 32,
  })) {
    text += d;
  }
  assert.equal(text, "MOCK-OK: Un deux trois");
});

test("SDK OpenAI + mock router : mauvaise clé → 401, TRIGGER_402 → 402", async () => {
  await assert.rejects(
    () =>
      generateReply({
        client: mockClient("mauvaise-cle"),
        modelId: "m:featherless-ai",
        messages: [{ role: "user", content: "salut" }],
      }),
    (e) => e instanceof VeniceError && e.status === 401
  );

  await assert.rejects(
    () =>
      generateReply({
        client: mockClient(MOCK_KEY),
        modelId: "m:featherless-ai",
        messages: [{ role: "user", content: "TRIGGER_402" }],
      }),
    (e) => e instanceof VeniceError && e.status === 402
  );
});

// --------------------------------------- intégration serveur HTTP (server.js)
function listenApp(env) {
  return new Promise((resolve) => {
    const srv = createApp(env).listen(0, "127.0.0.1", () => {
      resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` });
    });
  });
}

test("serveur : GET / sert le frontend, GET /style.css avec le bon MIME", async () => {
  const { srv, base } = await listenApp({ HF_API_KEY: MOCK_KEY });
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type"), /text\/html/);
    const html = await home.text();
    assert.match(html, /<title>Venice<\/title>/);
    assert.ok(!/Dolphin/.test(html), "le frontend ne doit plus mentionner Dolphin");
    assert.match(html, /Powered by Crazy Prince/);

    const css = await fetch(`${base}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /text\/css/);

    const missing = await fetch(`${base}/nope.txt`);
    assert.equal(missing.status, 404);
  } finally {
    srv.close();
  }
});

test("serveur : GET /api/health expose l'état sans la clé", async () => {
  const { srv, base } = await listenApp({ HF_API_KEY: MOCK_KEY });
  try {
    const res = await fetch(`${base}/api/health`);
    const h = await res.json();
    assert.equal(h.ok, true);
    assert.equal(h.keyConfigured, true);
    assert.equal(h.provider, "featherless-ai");
    assert.equal(h.name, "Venice");
    assert.ok(!JSON.stringify(h).includes(MOCK_KEY));
  } finally {
    srv.close();
  }
});

test("serveur : POST /api/chat DEMO_MODE non-stream", async () => {
  const { srv, base } = await listenApp({ DEMO_MODE: "1" });
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Salut" }] }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.demo, true);
    assert.match(data.reply, /MODE DÉMO/);
    assert.match(data.reply, /Salut/);
  } finally {
    srv.close();
  }
});

test("serveur : POST /api/chat DEMO_MODE stream SSE complet", async () => {
  const { srv, base } = await listenApp({ DEMO_MODE: "1" });
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Test stream" }], stream: true }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);
    const raw = await res.text();
    assert.match(raw, /^data: \{"status":"started"/m);
    assert.match(raw, /data: \[DONE\]/);
    const deltas = [...raw.matchAll(/^data: (\{.*\})$/gm)]
      .map((m) => JSON.parse(m[1]))
      .filter((o) => o.delta)
      .map((o) => o.delta)
      .join("");
    assert.equal(deltas, demoTextFrom("Test stream"));
  } finally {
    srv.close();
  }
});

test("serveur : erreurs — 405 GET, 400 rôle invalide, 400 JSON cassé, 500 sans clé", async () => {
  const { srv, base } = await listenApp({ HF_API_KEY: "", HF_TOKEN: "" });
  try {
    const get = await fetch(`${base}/api/chat`);
    assert.equal(get.status, 405);

    const badRole = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "root", content: "x" }] }),
    });
    assert.equal(badRole.status, 400);
    assert.match((await badRole.json()).error.message, /rôle invalide/);

    const broken = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{pas du json",
    });
    assert.equal(broken.status, 400);

    const noKey = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(OK_BODY),
    });
    assert.equal(noKey.status, 500);
    assert.match((await noKey.json()).error.message, /HF_API_KEY/);
  } finally {
    srv.close();
  }
});

test("serveur : protection traversée de répertoires", async () => {
  const { srv, base } = await listenApp({ DEMO_MODE: "1" });
  try {
    const res = await fetch(`${base}/%2e%2e/package.json`);
    assert.ok([403, 404].includes(res.status), `statut inattendu: ${res.status}`);
    const body = await res.text();
    assert.ok(!body.includes('"venice-chatbot"'), "package.json ne doit pas être servi");
  } finally {
    srv.close();
  }
});
