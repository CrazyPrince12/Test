// Serveur Node natif (zéro framework) :
//  - sert le frontend statique (public/)
//  - expose POST /api/chat et GET /api/health
// Utilisé en local, dans le sandbox, en preview et sur Render.
// Sur Vercel, c'est api/chat.js qui prend le relais pour l'API et le
// dossier public/ est servi automatiquement.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "./lib/env.js";
import { handleChatHttp, handleHealthHttp, sendJson } from "./lib/httpChat.js";

loadDotEnv(); // charge .env si présent (local / Render)

const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  // Protection contre la traversée de répertoires.
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: { status: 403, message: "Accès interdit." } });
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: { status: 404, message: "Ressource introuvable." } });
  }
}

export function createApp(env = process.env) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    try {
      if (pathname === "/api/chat" || pathname === "/api/chat/") {
        // ?stream=1 force le streaming (utile pour tester avec curl).
        if (url.searchParams.get("stream") === "1" && req.method === "POST") {
          const original = req;
          const body = await (await import("./lib/httpChat.js")).readJsonBody(original);
          body.stream = true;
          const { Readable } = await import("node:stream");
          const fakeReq = Readable.from([Buffer.from(JSON.stringify(body))]);
          fakeReq.method = "POST";
          fakeReq.headers = { "content-type": "application/json" };
          await handleChatHttp(fakeReq, res, env);
          return;
        }
        await handleChatHttp(req, res, env);
        return;
      }
      if (pathname === "/api/health" || pathname === "/api/health/") {
        handleHealthHttp(req, res, env);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { error: { status: 405, message: "Méthode non autorisée." } });
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (err) {
      console.error("[server] erreur inattendue:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { status: 500, message: "Erreur interne du serveur." } });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

/**
 * Démarre le serveur HTTP (listen sur PORT/HOST).
 * Exporté pour que les deux points d'entrée lancent le même serveur :
 *  - server.js, exécuté directement (`node server.js` / `npm start`)
 *  - index.js, exécuté par les plateformes qui cherchent `index.js`
 *    par défaut (ex. Render : "Running 'node index.js'")
 */
export function startServer() {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0"; // requis pour la preview sandbox et Render
  return createApp().listen(port, host, () => {
    console.log(`🐬 Dolphin Chatbot écoute sur http://${host}:${port}`);
    console.log(`   Modèle : ${process.env.HF_MODEL || "dphn/Dolphin-Mistral-24B-Venice-Edition"} (provider: ${process.env.HF_PROVIDER || "featherless-ai"})`);
    console.log(`   Clé HF configurée : ${process.env.HF_API_KEY || process.env.HF_TOKEN ? "oui" : "non (DEMO_MODE conseillé pour tester)"}`);
    console.log(`   DEMO_MODE : ${/^(1|true|yes)$/i.test(process.env.DEMO_MODE || "") ? "activé" : "désactivé"}`);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startServer();
}
