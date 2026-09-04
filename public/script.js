// script.js — interface de Venice (chatbot créé par Crazy Prince Dev).
//
// Le navigateur ne voit JAMAIS la clé d'API : il appelle uniquement
// /api/chat, c'est le serveur qui ajoute l'authentification. Les réglages
// du modèle (température, tokens) vivent côté serveur, dans le .env.

const BOT_NAME = "Venice";
const STORAGE_KEY = "venice.history.v1";
const THEME_KEY = "venice.theme";
const CONTEXT_WINDOW = 20; // messages envoyés au serveur (fenêtre de contexte)
const STORED_MESSAGES = 60; // messages relus au rechargement de la page

const el = {
  chat: document.getElementById("chat"),
  messages: document.getElementById("messages"),
  emptyState: document.getElementById("emptyState"),
  greeting: document.getElementById("greeting"),
  form: document.getElementById("chatForm"),
  input: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
  clearBtn: document.getElementById("clearChat"),
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  errorToast: document.getElementById("errorToast"),
  bubbles: document.getElementById("bubbles"),
};

let history = loadHistory();
let busy = false;
let toastTimer = null;

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function svgIcon(id, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", id === "icon-dolphin" ? "0 0 128 128" : "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(Number(value) || Date.now());
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

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
    /* localStorage indisponible : on continue en mémoire. */
  }
}

/* ------------------------------------------------------------------ */
/* Thème                                                               */
/* ------------------------------------------------------------------ */

function syncThemeIcon() {
  const deep = document.documentElement.dataset.theme !== "lagoon";
  el.themeIcon?.setAttribute("href", deep ? "#icon-sun" : "#icon-moon");
  const label = deep ? "Passer au thème lagon" : "Passer au thème abysses";
  el.themeToggle?.setAttribute("aria-label", label);
  el.themeToggle?.setAttribute("title", label);
}

el.themeToggle?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "lagoon" ? "deep" : "lagoon";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  syncThemeIcon();
});

/* ------------------------------------------------------------------ */
/* Message d'accueil selon l'heure                                     */
/* ------------------------------------------------------------------ */

const GREETINGS = [
  { start: 5, end: 12, options: ["Bonjour, bien réveillé ?", "Bonjour, prêt à attaquer la journée ?", "Salut ! On démarre du bon pied ?"] },
  { start: 12, end: 14, options: ["Bon appétit, on discute ?", "Bonjour, déjà midi ? Le temps file !"] },
  { start: 14, end: 18, options: ["L'après-midi avance bien ?", "Salut, belle après-midi ! Une question ?"] },
  { start: 18, end: 22, options: ["Bonsoir, comment se passe ta soirée ?", "Bonsoir ! On termine la journée en beauté ?"] },
  { start: 22, end: 24, options: ["Salut couche-tard, on veille ensemble ?", "Salut la nuit ! Qu'est-ce qu'on explore ?"] },
  { start: 0, end: 5, options: ["Encore debout ? Qu'est-ce qu'on fait ?", "Salut couche-tard, on plonge ?"] },
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
/* Rendu formaté des réponses (Markdown léger, 100 % DOM, zéro innerHTML) */
/*                                                                     */
/* La réponse de l'API est affichée en entier et mise en forme pour    */
/* rester lisible : titres, listes, gras, code, liens, tableaux.       */
/* Aucun innerHTML n'est utilisé : rien ne peut être injecté.          */
/* ------------------------------------------------------------------ */

function normalizeReply(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;

function appendInline(parent, text) {
  const parts = String(text).split(INLINE_PATTERN);
  for (const part of parts) {
    if (!part) continue;
    if (/^\*\*[^*\n]+\*\*$/.test(part) || /^__[^_\n]+__$/.test(part)) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      parent.append(strong);
    } else if (/^\*[^*\n]+\*$/.test(part) || /^_[^_\n]+_$/.test(part)) {
      const em = document.createElement("em");
      em.textContent = part.slice(1, -1);
      parent.append(em);
    } else if (/^`[^`\n]+`$/.test(part)) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      parent.append(code);
    } else if (/^\[[^\]\n]+\]\([^)\s]+\)$/.test(part)) {
      const match = part.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
      parent.append(safeLink(match[2], match[1]));
    } else if (/^https?:\/\//.test(part)) {
      parent.append(safeLink(part, part));
    } else {
      parent.append(document.createTextNode(part));
    }
  }
}

function safeLink(href, label) {
  const url = String(href);
  if (!/^https?:\/\//i.test(url)) return document.createTextNode(label);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;
  return a;
}

function makeCodeBlock(language, code) {
  const wrap = document.createElement("div");
  wrap.className = "code-block";

  const head = document.createElement("div");
  head.className = "code-head";
  const lang = document.createElement("span");
  lang.textContent = language || "code";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-msg";
  copy.dataset.copyCode = "";
  copy.append(svgIcon("icon-copy"), document.createTextNode("Copier"));
  head.append(lang, copy);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code.replace(/\n$/, "");
  pre.append(codeEl);

  wrap.append(head, pre);
  return wrap;
}

function makeTable(rows) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  const cells = rows.map((row) =>
    row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim())
  );

  const body = document.createElement("tbody");
  cells.forEach((row, index) => {
    const isSeparator = row.every((c) => /^:?-{2,}:?$/.test(c));
    if (isSeparator) return;
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement(index === 0 ? "th" : "td");
      appendInline(td, cell);
      tr.append(td);
    }
    body.append(tr);
  });

  table.append(body);
  wrap.append(table);
  return wrap;
}

function renderFormatted(container, text) {
  container.replaceChildren();
  const lines = normalizeReply(text).split("\n");
  let i = 0;

  const flushList = (ordered, items) => {
    const list = document.createElement(ordered ? "ol" : "ul");
    for (const item of items) {
      const li = document.createElement("li");
      appendInline(li, item);
      list.append(li);
    }
    container.append(list);
  };

  while (i < lines.length) {
    const line = lines[i];

    // Bloc de code ```lang … ```
    const fence = line.match(/^\s*```\s*([\w+#-]*)\s*$/);
    if (fence) {
      const language = fence[1];
      const buffer = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1; // saute la clôture
      container.append(makeCodeBlock(language, buffer.join("\n")));
      continue;
    }

    // Ligne vide
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Séparateur
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      container.append(document.createElement("hr"));
      i += 1;
      continue;
    }

    // Titre
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4);
      const h = document.createElement(`h${level}`);
      appendInline(h, heading[2].replace(/\s*#+\s*$/, ""));
      container.append(h);
      i += 1;
      continue;
    }

    // Tableau
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      container.append(makeTable(rows));
      continue;
    }

    // Citation
    if (/^\s*>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      const buffer = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buffer.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      appendInline(quote, buffer.join("\n"));
      container.append(quote);
      continue;
    }

    // Liste à puces
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      flushList(false, items);
      continue;
    }

    // Liste numérotée
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      flushList(true, items);
      continue;
    }

    // Paragraphe (lignes consécutives regroupées)
    const buffer = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) {
      buffer.push(lines[i]);
      i += 1;
    }
    const p = document.createElement("p");
    appendInline(p, buffer.join("\n"));
    container.append(p);
  }

  if (!container.childNodes.length) {
    const p = document.createElement("p");
    p.textContent = normalizeReply(text);
    container.append(p);
  }
}

/* ------------------------------------------------------------------ */
/* Construction des messages                                           */
/* ------------------------------------------------------------------ */

function buildMessage(role, content, options = {}) {
  const isBot = role === "assistant";
  const msg = document.createElement("div");
  msg.className = `msg msg-${isBot ? "bot" : "user"}`;
  msg.dataset.raw = content ?? "";

  const contentWrap = document.createElement("div");
  contentWrap.className = "msg-content";

  if (isBot) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const roleSpan = document.createElement("span");
    roleSpan.className = "msg-role";
    roleSpan.textContent = BOT_NAME;
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = formatTime(options.ts);
    meta.append(roleSpan, time);
    contentWrap.append(meta);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  if (isBot) renderFormatted(bubble, content);
  else bubble.textContent = content;
  contentWrap.append(bubble);

  if (isBot && content) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-msg";
    copy.dataset.copyMessage = "";
    copy.setAttribute("aria-label", "Copier le message");
    copy.append(svgIcon("icon-copy"), document.createTextNode("Copier"));
    actions.append(copy);
    contentWrap.append(actions);
  }

  const avatar = document.createElement("span");
  avatar.className = isBot ? "msg-avatar" : "msg-avatar msg-avatar-user";
  avatar.setAttribute("aria-hidden", "true");
  avatar.append(svgIcon(isBot ? "icon-dolphin" : "icon-user", ""));

  if (isBot) msg.append(avatar, contentWrap);
  else msg.append(contentWrap, avatar);

  return msg;
}

function appendMessage(role, content, options = {}) {
  const msg = buildMessage(role, content, options);
  el.messages.append(msg);
  animateIn(msg, role);
  syncEmptyState();
  scrollToBottom(true);
  return msg;
}

function appendTyping() {
  removeTyping();
  const msg = document.createElement("div");
  msg.className = "msg msg-bot msg-typing";
  msg.id = "typingMessage";

  const avatar = document.createElement("span");
  avatar.className = "msg-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.append(svgIcon("icon-dolphin", ""));

  const contentWrap = document.createElement("div");
  contentWrap.className = "msg-content";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const roleSpan = document.createElement("span");
  roleSpan.className = "msg-role";
  roleSpan.textContent = BOT_NAME;
  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime();
  meta.append(roleSpan, time);

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  const label = document.createElement("span");
  label.textContent = `${BOT_NAME} réfléchit`;
  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  bubble.append(label, dots);

  contentWrap.append(meta, bubble);
  msg.append(avatar, contentWrap);
  el.messages.append(msg);
  animateIn(msg, "assistant");
  scrollToBottom(true);
  return msg;
}

function removeTyping() {
  document.getElementById("typingMessage")?.remove();
}

function syncEmptyState() {
  const hasMessages = el.messages.children.length > 0;
  el.emptyState.hidden = hasMessages;
}

function scrollToBottom(force = false) {
  const chat = el.chat;
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 200;
  if (force || nearBottom) {
    requestAnimationFrame(() => {
      chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Animations GSAP (dégradation propre si le CDN n'est pas joignable)  */
/* ------------------------------------------------------------------ */

const gsap = window.gsap;
const motionOK = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const useGsap = Boolean(gsap) && motionOK;

function animateIn(node, role) {
  if (!useGsap) return;
  gsap.from(node, {
    opacity: 0,
    y: 18,
    x: role === "user" ? 18 : -18,
    duration: 0.45,
    ease: "power3.out",
  });
}

function initAnimations() {
  if (!useGsap) return;
  document.documentElement.classList.add("gsap-ready");

  gsap.from(".app-header", { y: -60, opacity: 0, duration: 0.7, ease: "power3.out" });
  gsap.from(".composer", { y: 40, opacity: 0, duration: 0.7, delay: 0.1, ease: "power3.out" });
  gsap.from(".composer-note", { opacity: 0, duration: 0.6, delay: 0.35 });

  // Le dauphin nage doucement, comme en pleine mer.
  gsap.to(".brand-dolphin", { y: -3, rotate: -4, duration: 2.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
  gsap.to(".empty-dolphin", { y: -14, rotate: 3, duration: 3.2, yoyo: true, repeat: -1, ease: "sine.inOut" });

  // Houle : trois vagues décalées.
  gsap.to(".wave-1", { xPercent: -18, duration: 18, yoyo: true, repeat: -1, ease: "sine.inOut" });
  gsap.to(".wave-2", { xPercent: -26, duration: 24, yoyo: true, repeat: -1, ease: "sine.inOut" });
  gsap.to(".wave-3", { xPercent: -12, duration: 30, yoyo: true, repeat: -1, ease: "sine.inOut" });

  spawnBubbles();
}

function animateEmptyState() {
  if (!useGsap) return;
  gsap.from(".empty-logo", { scale: 0.7, opacity: 0, duration: 0.8, ease: "back.out(1.7)" });
  gsap.from([".greeting", ".empty-sub"], { y: 20, opacity: 0, duration: 0.6, stagger: 0.1, ease: "power3.out" });
}

function spawnBubbles() {
  if (!useGsap || !el.bubbles) return;
  for (let i = 0; i < 16; i += 1) {
    const bubble = document.createElement("span");
    bubble.className = "bubble";
    const size = 4 + Math.random() * 16;
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${Math.random() * 100}%`;
    el.bubbles.append(bubble);

    gsap.to(bubble, {
      y: -(window.innerHeight + 120),
      x: `random(-40, 40)`,
      opacity: 0.55,
      duration: 10 + Math.random() * 14,
      delay: Math.random() * 12,
      repeat: -1,
      ease: "none",
      onRepeat: () => {
        bubble.style.left = `${Math.random() * 100}%`;
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* État du serveur (badge « connecté »)                                */
/* ------------------------------------------------------------------ */

async function refreshHealth() {
  try {
    const res = await fetch("/api/health");
    const health = await res.json();
    el.statusBadge.classList.remove("status-loading", "status-ok", "status-demo", "status-error");
    if (health.demoMode) {
      el.statusBadge.classList.add("status-demo");
      el.statusText.textContent = "mode démo";
    } else if (health.keyConfigured) {
      el.statusBadge.classList.add("status-ok");
      el.statusText.textContent = "connecté";
    } else {
      el.statusBadge.classList.add("status-error");
      el.statusText.textContent = "clé manquante";
    }
  } catch {
    el.statusBadge.classList.remove("status-loading", "status-ok", "status-demo");
    el.statusBadge.classList.add("status-error");
    el.statusText.textContent = "hors ligne";
  }
}

/* ------------------------------------------------------------------ */
/* Toast d'erreur                                                      */
/* ------------------------------------------------------------------ */

function showToast(message, action) {
  clearTimeout(toastTimer);
  el.errorToast.replaceChildren();

  const body = document.createElement("div");
  body.className = "toast-body";
  const title = document.createElement("strong");
  title.textContent = message;
  body.append(title);
  if (action) {
    const span = document.createElement("span");
    span.className = "toast-action";
    span.textContent = action;
    body.append(span);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Fermer");
  close.append(svgIcon("icon-close"));
  close.addEventListener("click", hideToast);

  el.errorToast.append(svgIcon("icon-alert"), body, close);
  el.errorToast.hidden = false;
  if (useGsap) gsap.from(el.errorToast, { y: 20, opacity: 0, duration: 0.3, ease: "power2.out" });
  toastTimer = setTimeout(hideToast, 9000);
}

function hideToast() {
  clearTimeout(toastTimer);
  el.errorToast.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Copie                                                               */
/* ------------------------------------------------------------------ */

async function copyText(text, button) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
  }

  const label = button.lastChild;
  if (label && label.nodeType === Node.TEXT_NODE) {
    const original = label.textContent;
    label.textContent = ok ? "Copié" : "Erreur";
    setTimeout(() => {
      label.textContent = original;
    }, 1600);
  }
}

document.addEventListener("click", (event) => {
  const codeBtn = event.target.closest("[data-copy-code]");
  if (codeBtn) {
    copyText(codeBtn.closest(".code-block")?.querySelector("code")?.textContent || "", codeBtn);
    return;
  }
  const msgBtn = event.target.closest("[data-copy-message]");
  if (msgBtn) {
    const msg = msgBtn.closest(".msg");
    copyText(msg?.dataset.raw || msg?.querySelector(".msg-bubble")?.textContent || "", msgBtn);
  }
});

/* ------------------------------------------------------------------ */
/* Envoi + streaming                                                   */
/* ------------------------------------------------------------------ */

function setBusy(state) {
  busy = state;
  el.sendBtn.disabled = state;
  el.sendBtn.setAttribute("aria-busy", state ? "true" : "false");
}

function autoResize() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
}

function buildPayload() {
  return {
    messages: history.slice(-CONTEXT_WINDOW).map(({ role, content }) => ({ role, content })),
    stream: true,
  };
}

async function sendMessage(text) {
  if (!text || busy) return;

  const now = Date.now();
  history.push({ role: "user", content: text, ts: now });
  saveHistory();
  const userMessageEl = appendMessage("user", text, { ts: now });

  setBusy(true);
  hideToast();
  appendTyping();

  let bubble = null;
  let streamWrap = null;
  let answer = "";

  const finishBubble = () => {
    if (!bubble) return;
    const msg = bubble.closest(".msg");
    msg?.classList.remove("streaming");
    if (msg) msg.dataset.raw = answer;
    renderFormatted(bubble, answer);
    const contentWrap = bubble.parentElement;
    if (contentWrap && !contentWrap.querySelector(".msg-actions")) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-msg";
      copy.dataset.copyMessage = "";
      copy.setAttribute("aria-label", "Copier le message");
      copy.append(svgIcon("icon-copy"), document.createTextNode("Copier"));
      actions.append(copy);
      contentWrap.append(actions);
    }
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const chunk of events) {
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const data = dataLine.slice(6);
          if (data === "[DONE]") {
            done = true;
            break;
          }
          let obj;
          try {
            obj = JSON.parse(data);
          } catch {
            continue; // trame partielle
          }
          if (obj.error) throw Object.assign(new Error(obj.error.message), { detail: obj.error.detail });
          if (typeof obj.delta !== "string") continue;

          if (!bubble) {
            removeTyping();
            const msg = appendMessage("assistant", "", { ts: Date.now() });
            msg.classList.add("streaming");
            bubble = msg.querySelector(".msg-bubble");
            streamWrap = document.createElement("span");
            streamWrap.className = "stream-text";
            bubble.replaceChildren(streamWrap);
          }
          answer += obj.delta;
          streamWrap.textContent = answer;
          scrollToBottom();
        }
      }

      removeTyping();
      if (!answer.trim()) throw new Error("Réponse vide.");
      finishBubble();
      history.push({ role: "assistant", content: answer, ts: Date.now() });
      saveHistory();
      scrollToBottom();
      return;
    }

    // Réponse JSON (mode non-stream ou erreur normalisée).
    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new Error(`Erreur HTTP ${res.status}.`);
    }
    if (!res.ok || payload.error) {
      const e = payload.error ?? { message: "Erreur inconnue." };
      throw Object.assign(new Error(e.message), { detail: e.detail });
    }
    removeTyping();
    answer = payload.reply;
    history.push({ role: "assistant", content: answer, ts: Date.now() });
    saveHistory();
    appendMessage("assistant", answer, { ts: Date.now() });
  } catch (error) {
    removeTyping();

    if (answer.trim()) {
      // Réponse partielle : on la garde, elle vaut mieux que rien.
      finishBubble();
      history.push({ role: "assistant", content: answer, ts: Date.now() });
    } else {
      // Aucun contenu reçu : on retire la tentative et on rend le texte
      // à l'utilisateur pour qu'il n'ait pas à le retaper.
      bubble?.closest(".msg")?.remove();
      userMessageEl?.remove();
      history.pop();
      if (!el.input.value.trim()) el.input.value = text;
    }
    saveHistory();
    syncEmptyState();
    showToast(error.message || "Une erreur est survenue.", error.detail || "");
  } finally {
    setBusy(false);
    autoResize();
    el.input.focus();
  }
}

/* ------------------------------------------------------------------ */
/* Événements                                                          */
/* ------------------------------------------------------------------ */

el.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = el.input.value.trim();
  if (!value) return;
  el.input.value = "";
  autoResize();
  sendMessage(value);
});

el.input.addEventListener("input", autoResize);

el.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.form.requestSubmit();
  }
});

el.clearBtn.addEventListener("click", () => {
  history = [];
  saveHistory();
  el.messages.replaceChildren();
  hideToast();
  renderGreeting();
  syncEmptyState();
  animateEmptyState();
  el.input.value = "";
  autoResize();
  el.input.focus();
});

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

function restoreHistory() {
  for (const message of history) {
    el.messages.append(buildMessage(message.role, message.content, { ts: message.ts }));
  }
}

function init() {
  syncThemeIcon();
  renderGreeting();
  restoreHistory();
  syncEmptyState();
  autoResize();
  initAnimations();
  if (!history.length) animateEmptyState();
  refreshHealth();
  setInterval(refreshHealth, 60_000);
  el.input.focus();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.chat.scrollTop = el.chat.scrollHeight;
    });
  });
}

init();
