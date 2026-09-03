// Frontend Dolphin Chat.
// Le navigateur ne voit JAMAIS la clé HF : il appelle uniquement /api/chat,
// c'est le serveur qui ajoute l'authentification vers Hugging Face.

const chatArea = document.getElementById("chatArea");
const emptyState = document.getElementById("emptyState");
const form = document.getElementById("chatForm");
const input = document.getElementById("promptInput");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const systemPromptInput = document.getElementById("systemPromptInput");
const temperatureInput = document.getElementById("temperatureInput");
const tempValue = document.getElementById("tempValue");
const maxTokensInput = document.getElementById("maxTokensInput");
const maxTokensValue = document.getElementById("maxTokensValue");

/** Historique de la conversation (messages role/content envoyés à l'API). */
const history = [];
let busy = false;
let demoBannerShown = false;

// ---------- État du serveur ----------
async function refreshHealth() {
  try {
    const res = await fetch("/api/health");
    const h = await res.json();
    document.getElementById("modelName").textContent = h.model;
    document.getElementById("providerName").textContent = h.provider;
    systemPromptInput.value = h.defaults.systemPrompt;
    temperatureInput.value = h.defaults.temperature;
    tempValue.value = h.defaults.temperature;
    maxTokensInput.value = h.defaults.maxTokens;
    maxTokensValue.value = h.defaults.maxTokens;

    statusBadge.classList.remove("status-loading", "status-ok", "status-demo", "status-error");
    if (h.demoMode) {
      statusBadge.classList.add("status-demo");
      statusText.textContent = "mode démo";
    } else if (h.keyConfigured) {
      statusBadge.classList.add("status-ok");
      statusText.textContent = "connecté";
    } else {
      statusBadge.classList.add("status-error");
      statusText.textContent = "clé manquante";
    }
  } catch {
    statusBadge.classList.remove("status-loading", "status-ok", "status-demo");
    statusBadge.classList.add("status-error");
    statusText.textContent = "serveur injoignable";
  }
}

// ---------- Rendu ----------
function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

function addMessage(role, content) {
  emptyState?.remove();
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "🧑" : "🐬";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  wrap.append(avatar, bubble);
  chatArea.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

function addErrorMessage(text) {
  emptyState?.remove();
  const wrap = document.createElement("div");
  wrap.className = "msg error";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "⚠️";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.append(avatar, bubble);
  chatArea.appendChild(wrap);
  scrollToBottom();
}

// ---------- Appel API ----------
function buildPayload() {
  return {
    messages: history,
    systemPrompt: systemPromptInput.value.trim() || undefined,
    temperature: Number(temperatureInput.value),
    max_tokens: Number(maxTokensInput.value),
    stream: true,
  };
}

async function sendPrompt(text) {
  history.push({ role: "user", content: text });
  addMessage("user", text);

  const bubble = addMessage("assistant", "");
  bubble.classList.add("cursor");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      let assistantText = "";
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
            if (obj.error) throw new Error(obj.error.message || "Erreur du serveur.");
            if (obj.demo && !demoBannerShown) demoBannerShown = true;
            if (typeof obj.delta === "string") {
              assistantText += obj.delta;
              bubble.textContent = assistantText;
              scrollToBottom();
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // frame partielle
            throw parseErr;
          }
        }
      }

      bubble.classList.remove("cursor");
      if (!assistantText.trim()) throw new Error("Le serveur a renvoyé une réponse vide.");
      history.push({ role: "assistant", content: assistantText });
    } else {
      // Réponse JSON (erreur normalisée ou mode non-stream).
      let payload;
      try {
        payload = await res.json();
      } catch {
        throw new Error(`Erreur HTTP ${res.status} (réponse non JSON).`);
      }
      bubble.closest(".msg").remove();
      if (!res.ok || payload.error) {
        const e = payload.error ?? { status: res.status, message: "Erreur inconnue." };
        throw Object.assign(new Error(e.message), { detail: e.detail, status: e.status });
      }
      history.push({ role: "assistant", content: payload.reply });
      addMessage("assistant", payload.reply);
      return;
    }
  } catch (err) {
    bubble.classList.remove("cursor");
    if (!bubble.textContent.trim()) bubble.closest(".msg")?.remove();
    history.pop(); // le message user n'a pas obtenu de réponse valide
    addErrorMessage(
      err.detail ? `${err.message}\n\nDétail : ${err.detail}` : err.message || String(err)
    );
  }
}

// ---------- Événements ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const text = input.value.trim();
  if (!text) return;
  busy = true;
  sendBtn.disabled = true;
  input.value = "";
  input.style.height = "auto";
  try {
    await sendPrompt(text);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});

newChatBtn.addEventListener("click", () => {
  history.length = 0;
  chatArea.innerHTML = "";
  chatArea.appendChild(emptyState);
  input.focus();
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    input.value = chip.textContent.trim();
    input.focus();
    form.requestSubmit();
  });
});

temperatureInput.addEventListener("input", () => (tempValue.value = temperatureInput.value));
maxTokensInput.addEventListener("input", () => (maxTokensValue.value = maxTokensInput.value));

refreshHealth();
input.focus();
