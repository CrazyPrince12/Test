// Venice — interface de chat.
// Le navigateur ne voit JAMAIS la clé HF : il appelle uniquement /api/chat,
// c'est le serveur qui ajoute l'authentification vers Hugging Face.
// L'appel API (POST /api/chat + flux SSE) est identique à l'implémentation
// d'origine : seul l'habillage change.

import { renderMarkdown } from "./markdown.js";
import { svgIcon, copyToClipboard } from "./ui-utils.js";

const STORAGE_KEY = "venice.history.v1";
const STORED_MESSAGES = 40;
const BOT_NAME = "Venice";

const el = {
  chat: document.getElementById("chat"),
  messages: document.getElementById("messages"),
  emptyState: document.getElementById("empty-state"),
  emptyLogo: document.getElementById("empty-logo"),
  greeting: document.getElementById("greeting"),
  subtitle: document.getElementById("empty-subtitle"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("user-input"),
  sendBtn: document.getElementById("send-btn"),
  clearBtn: document.getElementById("clear-chat"),
  statusBadge: document.getElementById("status-badge"),
  statusText: document.getElementById("status-text"),
  toast: document.getElementById("error-toast"),
  bubbles: document.getElementById("bubbles"),
};

const reduceMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
const gsap = window.gsap;

/** Historique complet (envoyé à l'API + persisté localement). */
let history = loadHistory();
let busy = false;
let toastTimer = null;

/* ------------------------------------------------------------------ */
/* Persistance                                                         */
/* ------------------------------------------------------------------ */

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content, ts: Number.isFinite(m.ts) ? m.ts : Date.now() }));
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-STORED_MESSAGES)));
  } catch {
    /* stockage indisponible : on continue en mémoire. */
  }
}

/* ------------------------------------------------------------------ */
/* Accueil selon l'heure locale                                        */
/* ------------------------------------------------------------------ */

const GREETINGS = [
  { start: 5, end: 12, options: ["Bonjour, bien réveillé ?", "Bonjour, prêt à attaquer la journée ?", "Salut ! Tu démarres du bon pied ?"] },
  { start: 12, end: 14, options: ["Bon après-midi, cher ami", "Déjà midi ? Le temps file !"] },
  { start: 14, end: 18, options: ["L'après-midi avance bien ?", "Salut, belle après-midi ! Une question ?"] },
  { start: 18, end: 22, options: ["Bonsoir, comment se passe ta soirée ?", "Bonsoir ! On termine la journée en beauté ?"] },
  { start: 22, end: 24, options: ["Salut couche-tard, on veille ensemble ?", "Salut la nuit ! Qu'est-ce qu'on explore ?"] },
  { start: 0, end: 5, options: ["Encore debout ? Qu'est-ce qu'on fait ?", "Salut couche-tard, on veille ensemble ?"] },
];

function getGreeting() {
  const hour = new Date().getHours();
  const bucket = GREETINGS.find((g) => hour >= g.start && hour < g.end) || GREETINGS[0];
  return bucket.options[(hour + bucket.start) % bucket.options.length];
}

function renderGreeting() {
  el.greeting.textContent = getGreeting();
}

/* ------------------------------------------------------------------ */
/* Utilitaires UI                                                      */
/* ------------------------------------------------------------------ */

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(Number(value) || Date.now());
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom(force = false) {
  const nearBottom = el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 180;
  if (force || nearBottom) {
    requestAnimationFrame(() => {
      el.chat.scrollTop = el.chat.scrollHeight;
    });
  }
}

function syncEmptyState() {
  el.emptyState.hidden = el.messages.children.length > 0;
}

function showToast(message, detail) {
  clearTimeout(toastTimer);
  el.toast.replaceChildren();

  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = message;
  body.append(title);
  if (detail) {
    const span = document.createElement("span");
    span.className = "toast-detail";
    span.textContent = detail;
    body.append(span);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Fermer");
  close.append(svgIcon("i-close"));
  close.addEventListener("click", hideToast);

  el.toast.append(svgIcon("i-alert"), body, close);
  el.toast.hidden = false;
  if (gsap && !reduceMotion) {
    gsap.fromTo(el.toast, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power2.out" });
  }
  toastTimer = setTimeout(hideToast, 9000);
}

function hideToast() {
  clearTimeout(toastTimer);
  el.toast.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Construction des messages                                           */
/* ------------------------------------------------------------------ */

function botAvatar() {
  const img = document.createElement("img");
  img.className = "msg-avatar";
  img.src = "/assets/venice.svg";
  img.width = 36;
  img.height = 36;
  img.alt = "";
  return img;
}

function userAvatar() {
  const span = document.createElement("span");
  span.className = "msg-avatar";
  span.setAttribute("aria-hidden", "true");
  span.append(svgIcon("i-user"));
  return span;
}

function buildMessage(role, content, options = {}) {
  const isBot = role === "assistant";
  const msg = document.createElement("div");
  msg.className = `msg msg-${isBot ? "bot" : "user"}`;

  const wrap = document.createElement("div");
  wrap.className = "msg-content";

  if (isBot) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const name = document.createElement("span");
    name.className = "msg-role";
    name.textContent = BOT_NAME;
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = formatTime(options.ts);
    meta.append(name, time);
    wrap.append(meta);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  if (isBot) renderMarkdown(bubble, content);
  else bubble.textContent = content;
  wrap.append(bubble);

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  if (isBot && content) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-msg";
    copy.setAttribute("aria-label", "Copier la réponse");
    copy.append(svgIcon("i-copy"), document.createTextNode("Copier"));
    copy.addEventListener("click", () => copyToClipboard(msg.dataset.raw || bubble.textContent, copy));
    actions.append(copy);
  }
  wrap.append(actions);

  msg.dataset.raw = content;

  if (isBot) msg.append(botAvatar(), wrap);
  else msg.append(wrap, userAvatar());

  return msg;
}

function animateIn(node) {
  if (!gsap || reduceMotion) return;
  gsap.from(node, { y: 20, opacity: 0, scale: 0.985, duration: 0.45, ease: "power2.out" });
}

function appendMessage(role, content, options = {}) {
  const msg = buildMessage(role, content, options);
  el.messages.append(msg);
  syncEmptyState();
  animateIn(msg);
  scrollToBottom(true);
  return msg;
}

/** Bulle du bot en cours de rédaction : dots de typing puis texte streamé. */
function appendPendingBot() {
  const msg = document.createElement("div");
  msg.className = "msg msg-bot msg-typing";

  const wrap = document.createElement("div");
  wrap.className = "msg-content";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const name = document.createElement("span");
  name.className = "msg-role";
  name.textContent = BOT_NAME;
  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime();
  meta.append(name, time);

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  const label = document.createElement("span");
  label.textContent = `${BOT_NAME} réfléchit`;
  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  bubble.append(label, dots);

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  wrap.append(meta, bubble, actions);
  msg.append(botAvatar(), wrap);
  el.messages.append(msg);
  syncEmptyState();
  animateIn(msg);
  scrollToBottom(true);

  return { msg, bubble, actions };
}

/* ------------------------------------------------------------------ */
/* Appel API (inchangé : POST /api/chat, flux SSE)                     */
/* ------------------------------------------------------------------ */

function apiMessages() {
  return history.map(({ role, content }) => ({ role, content }));
}

async function sendPrompt(text) {
  const now = Date.now();
  history.push({ role: "user", content: text, ts: now });
  saveHistory();
  appendMessage("user", text, { ts: now });

  const pending = appendPendingBot();
  let assistantText = "";
  let streaming = false;

  const startStreaming = () => {
    if (streaming) return;
    streaming = true;
    pending.msg.classList.remove("msg-typing");
    pending.bubble.replaceChildren();
    pending.bubble.classList.add("is-streaming");
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages(), stream: true }),
    });

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventChunk of events) {
          const dataLine = eventChunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const data = dataLine.slice(6);
          if (data === "[DONE]") break;
          try {
            const obj = JSON.parse(data);
            if (obj.error) throw Object.assign(new Error(obj.error.message || "Erreur du serveur."), { detail: obj.error.detail });
            if (typeof obj.delta === "string") {
              startStreaming();
              assistantText += obj.delta;
              pending.bubble.textContent = assistantText;
              scrollToBottom();
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // trame partielle
            throw parseErr;
          }
        }
      }

      if (!assistantText.trim()) throw new Error("Le serveur a renvoyé une réponse vide.");
    } else {
      // Réponse JSON (erreur normalisée ou mode non-stream).
      let payload;
      try {
        payload = await res.json();
      } catch {
        throw new Error(`Erreur HTTP ${res.status} (réponse non JSON).`);
      }
      if (!res.ok || payload.error) {
        const e = payload.error ?? { status: res.status, message: "Erreur inconnue." };
        throw Object.assign(new Error(e.message), { detail: e.detail, status: e.status });
      }
      assistantText = payload.reply;
    }

    // Réponse complète : on la reformate (Markdown → DOM).
    const ts = Date.now();
    pending.msg.remove();
    history.push({ role: "assistant", content: assistantText, ts });
    saveHistory();
    appendMessage("assistant", assistantText, { ts });
    hideToast();
  } catch (err) {
    pending.msg.remove();
    history.pop(); // le message utilisateur n'a pas obtenu de réponse valide
    saveHistory();
    syncEmptyState();
    showToast(err.message || String(err), err.detail);
    if (!el.input.value.trim()) {
      el.input.value = text;
      autoResize();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

function autoResize() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
}

el.input.addEventListener("input", autoResize);

el.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.form.requestSubmit();
  }
});

el.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const text = el.input.value.trim();
  if (!text) return;

  busy = true;
  el.sendBtn.disabled = true;
  el.input.value = "";
  autoResize();
  if (gsap && !reduceMotion) gsap.fromTo(el.sendBtn, { scale: 0.86 }, { scale: 1, duration: 0.35, ease: "back.out(3)" });

  try {
    await sendPrompt(text);
  } finally {
    busy = false;
    el.sendBtn.disabled = false;
    el.input.focus();
  }
});

/* ------------------------------------------------------------------ */
/* Effacer la conversation                                             */
/* ------------------------------------------------------------------ */

function clearConversation() {
  history = [];
  saveHistory();
  el.messages.replaceChildren();
  renderGreeting();
  syncEmptyState();
  hideToast();
  el.input.value = "";
  autoResize();
  el.input.focus();
  if (gsap && !reduceMotion) {
    gsap.fromTo(el.emptyState, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" });
  }
}

el.clearBtn.addEventListener("click", () => {
  if (gsap && !reduceMotion) {
    gsap.fromTo(el.clearBtn.querySelector(".icon"), { rotate: 0 }, { rotate: 360, duration: 0.5, ease: "power2.inOut" });
    const nodes = [...el.messages.children];
    if (nodes.length) {
      gsap.to(nodes, {
        opacity: 0,
        y: -14,
        duration: 0.25,
        stagger: 0.03,
        ease: "power1.in",
        onComplete: clearConversation,
      });
      return;
    }
  }
  clearConversation();
});

/* ------------------------------------------------------------------ */
/* État de la connexion (badge « connecté »)                           */
/* ------------------------------------------------------------------ */

async function refreshHealth() {
  el.statusBadge.className = "status-badge";
  try {
    const res = await fetch("/api/health");
    const health = await res.json();
    if (health.demoMode) {
      el.statusBadge.classList.add("is-demo");
      el.statusText.textContent = "mode démo";
    } else if (health.keyConfigured) {
      el.statusBadge.classList.add("is-ok");
      el.statusText.textContent = "connecté";
    } else {
      el.statusBadge.classList.add("is-error");
      el.statusText.textContent = "clé manquante";
    }
  } catch {
    el.statusBadge.classList.add("is-error");
    el.statusText.textContent = "hors ligne";
  }
}

/* ------------------------------------------------------------------ */
/* Animations GSAP (décor marin + entrées)                             */
/* ------------------------------------------------------------------ */

function spawnBubbles() {
  if (!gsap || reduceMotion) return;
  const count = window.innerWidth < 620 ? 12 : 22;
  for (let i = 0; i < count; i++) {
    const bubble = document.createElement("span");
    bubble.className = "bubble";
    const size = gsap.utils.random(5, 22);
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${gsap.utils.random(0, 100)}%`;
    el.bubbles.append(bubble);

    const drift = gsap.utils.random(-60, 60);
    gsap.to(bubble, {
      y: () => -(window.innerHeight + 120),
      x: drift,
      opacity: gsap.utils.random(0.25, 0.7),
      duration: gsap.utils.random(11, 22),
      delay: gsap.utils.random(0, 14),
      repeat: -1,
      ease: "none",
      onRepeat: () => {
        bubble.style.left = `${gsap.utils.random(0, 100)}%`;
      },
    });
  }
}

function introAnimations() {
  if (!gsap || reduceMotion) return;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from(".app-header", { y: -70, opacity: 0, duration: 0.6 })
    .from(el.emptyLogo, { scale: 0.5, opacity: 0, rotate: -12, duration: 0.7, ease: "back.out(1.6)" }, "-=0.25")
    .from([el.greeting, el.subtitle], { y: 24, opacity: 0, duration: 0.55, stagger: 0.1 }, "-=0.35")
    .from(".composer-wrap", { y: 60, opacity: 0, duration: 0.6 }, "-=0.5");

  // Le dauphin flotte doucement, comme porté par la houle.
  gsap.to(el.emptyLogo, {
    y: -12,
    rotate: 3,
    delay: 1.2,
    duration: 3.2,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });

  gsap.to(".ocean-glow", {
    opacity: 0.55,
    scale: 1.08,
    duration: 6,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });

  gsap.to(".ocean-caustics", {
    backgroundPositionX: "260px",
    duration: 28,
    repeat: -1,
    ease: "none",
  });
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

function restoreHistory() {
  for (const message of history) {
    el.messages.append(buildMessage(message.role, message.content, { ts: message.ts }));
  }
}

function init() {
  renderGreeting();
  restoreHistory();
  syncEmptyState();
  autoResize();
  refreshHealth();
  spawnBubbles();
  introAnimations();
  el.input.focus();
  requestAnimationFrame(() => {
    el.chat.scrollTop = el.chat.scrollHeight;
  });
}

init();
window.addEventListener("online", refreshHealth);
window.addEventListener("offline", refreshHealth);
