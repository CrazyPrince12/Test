import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { parseDotEnv, loadDotEnv } from "../lib/env.js";
import { getConfig, DEFAULT_SYSTEM_PROMPT } from "../lib/config.js";
import { validateChatPayload, applySystemPrompt, ValidationError } from "../lib/messages.js";
import {
  DolphinError,
  mapProviderError,
  generateReply,
  streamReply,
  demoTextFrom,
} from "../lib/dolphin.js";
import { InferenceClient, InferenceClientProviderApiError } from "@huggingface/inference";
import { createApp } from "../server.js";
import { startMockRouter, makeRedirectFetch, MOCK_KEY } from "./mock-hf-server.mjs";

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
test("config : valeurs par défaut issues de la fiche (temp 0.15, provider featherless)", () => {
  const cfg = getConfig({});
  assert.equal(cfg.provider, "featherless-ai");
  assert.equal(cfg.model, "dphn/Dolphin-Mistral-24B-Venice-Edition");
  assert.equal(cfg.apiKey, "");
  assert.equal(cfg.demoMode, false);
  assert.equal(getConfig({ DEMO_MODE: "1" }).demoMode, true);
});

// ---------------------------------------------------------------- validation
test("validation : requête minimale OK + défauts 0.15/512", () => {
  const v = validateChatPayload(OK_BODY);
  assert.equal(v.temperature, 0.15);
  assert.equal(v.maxTokens, 512);
  assert.equal(v.stream, false);
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
  const err = new InferenceClientProviderApiError(
    "Payment required",
    { url: "https://router.huggingface.co/featherless-ai/v1/chat/completions", method: "POST" },
    { status: 402, body: { error: { message: "You have exceeded your monthly included credits." } } }
  );
  const mapped = mapProviderError(err);
  assert.ok(mapped instanceof DolphinError);
  assert.equal(mapped.status, 402);
  assert.match(mapped.message, /[Cc]rédits/);
});

test("mapProviderError : réseau → 503, timeout → 504, inconnu → 502", () => {
  assert.equal(mapProviderError(new TypeError("fetch failed")).status, 503);
  const t = new Error("trop lent");
  t.name = "TimeoutError";
  assert.equal(mapProviderError(t).status, 504);
  assert.equal(mapProviderError(new Error("bizarre")).status, 502);
});

// ---------------------------------------------------------------- SDK
test("SDK : InferenceClient expose chatCompletion et chatCompletionStream", () => {
  const client = new InferenceClient("cle-factice");
  assert.equal(typeof client.chatCompletion, "function");
  assert.equal(typeof client.chatCompletionStream, "function");
});

test("dolphin : generateReply avec client injecté renvoie le texte", async () => {
  const client = {
    chatCompletion: async () => ({
      model: "m",
      choices: [{ message: { content: "Réponse factice" } }],
      usage: { total_tokens: 1 },
    }),
  };
  const out = await generateReply({ client, messages: OK_BODY.messages, model: "m", provider: "p" });
  assert.equal(out.reply, "Réponse factice");
  assert.equal(out.usage.total_tokens, 1);
});

test("dolphin : generateReply remappe les erreurs du client", async () => {
  const client = {
    chatCompletion: async () => {
      throw new TypeError("fetch failed");
    },
  };
  await assert.rejects(
    () => generateReply({ client, messages: OK_BODY.messages, model: "m", provider: "p" }),
    (e) => e instanceof DolphinError && e.status === 503
  );
});

test("dolphin : streamReply concatène les deltas", async () => {
  async function* chunks() {
    yield { choices: [{ delta: { content: "Bon" } }] };
    yield { choices: [{ delta: { content: "jour" } }] };
    yield { choices: [{ delta: {} }] };
  }
  const client = { chatCompletionStream: async () => chunks() };
  let text = "";
  for await (const d of streamReply({ client, messages: OK_BODY.messages, model: "m", provider: "p" })) {
    text += d;
  }
  assert.equal(text, "Bonjour");
});

// ------------------------------------------- intégration SDK ↔ mock router HTTP
let mock, redirectFetch;
before(async () => {
  mock = await startMockRouter();
  redirectFetch = makeRedirectFetch(mock.url);
});
after(() => mock.server.close());

test("SDK + mock router : non-stream OK (payload complet envoyé au provider)", async () => {
  const client = new InferenceClient(MOCK_KEY);
  const calls = [];
  const spyFetch = (url, init) => {
    calls.push({ url: String(url), init });
    return redirectFetch(url, init);
  };
  const out = await generateReply(
    {
      client,
      apiKey: MOCK_KEY,
      model: "dphn/Dolphin-Mistral-24B-Venice-Edition",
      provider: "featherless-ai",
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "Ping réseau" },
      ],
      temperature: 0.15,
      maxTokens: 64,
    },
    { fetch: spyFetch }
  );
  assert.equal(out.reply, "MOCK-OK: Ping réseau");
  // Le SDK fait 1) GET /api/models (résolution provider) puis 2) POST chat/completions.
  assert.ok(calls.some((c) => c.url.includes("/api/models/")));
  const post = calls.find((c) => c.url.includes("/v1/chat/completions"));
  assert.ok(post, "l'appel chat/completions doit avoir lieu");
  const sent = JSON.parse(post.init.body);
  const headers = post.init.headers;
  const auth =
    headers instanceof Headers
      ? headers.get("authorization")
      : headers.Authorization ?? headers.authorization ?? null;
  assert.equal(auth, `Bearer ${MOCK_KEY}`);
  assert.equal(sent.temperature, 0.15);
  assert.equal(sent.max_tokens, 64);
  assert.equal(sent.messages[0].role, "system");
});

test("SDK + mock router : stream OK, tokens dans l'ordre", async () => {
  const client = new InferenceClient(MOCK_KEY);
  let text = "";
  for await (const d of streamReply(
    {
      client,
      model: "dphn/Dolphin-Mistral-24B-Venice-Edition",
      provider: "featherless-ai",
      messages: [{ role: "user", content: "Un deux trois" }],
      temperature: 0.15,
      maxTokens: 32,
    },
    { fetch: redirectFetch }
  )) {
    text += d;
  }
  assert.equal(text, "MOCK-OK: Un deux trois");
});

test("SDK + mock router : mauvaise clé → 401, TRIGGER_402 → 402", async () => {
  await assert.rejects(
    () =>
      generateReply(
        {
          client: new InferenceClient("mauvaise-cle"),
          model: "m",
          provider: "featherless-ai",
          messages: [{ role: "user", content: "salut" }],
        },
        { fetch: redirectFetch }
      ),
    (e) => e instanceof DolphinError && e.status === 401
  );

  await assert.rejects(
    () =>
      generateReply(
        {
          client: new InferenceClient(MOCK_KEY),
          model: "m",
          provider: "featherless-ai",
          messages: [{ role: "user", content: "TRIGGER_402" }],
        },
        { fetch: redirectFetch }
      ),
    (e) => e instanceof DolphinError && e.status === 402
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
    assert.match(await home.text(), /Dolphin Chat/);

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
    assert.equal(h.defaults.temperature, 0.15);
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
    assert.ok(!body.includes('"dolphin-chatbot"'), "package.json ne doit pas être servi");
  } finally {
    srv.close();
  }
});
