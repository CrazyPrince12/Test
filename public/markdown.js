// Rendu enrichi des réponses de Venice.
//
// L'API renvoie du texte Markdown : on le transforme en vrais éléments DOM
// (titres, listes, tableaux, blocs de code, gras/italique, liens) pour que la
// réponse soit affichée EN ENTIER et facile à lire.
//
// Sécurité : tout est construit avec createElement/textContent — jamais
// d'innerHTML — donc aucun contenu du modèle ne peut être interprété comme du
// HTML ou du script.

import { svgIcon, copyToClipboard } from "./ui-utils.js";

const INLINE_RX =
  /(`[^`\n]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]\n]+\]\([^\s)]+\))|((?:https?:\/\/|www\.)[^\s<>()]+)/g;

const BULLET_RX = /^\s*([-*+•])\s+(.*)$/;
const ORDERED_RX = /^\s*(\d+)[.)]\s+(.*)$/;

function makeLink(href, label) {
  const safe = /^(https?:)?\/\//i.test(href) ? href : `https://${href}`;
  const a = document.createElement("a");
  a.href = safe;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;
  return a;
}

/** Applique le formatage « en ligne » (gras, italique, code, liens…). */
export function renderInline(target, text) {
  const source = String(text ?? "");
  let last = 0;

  for (const match of source.matchAll(INLINE_RX)) {
    const token = match[0];
    if (match.index > last) target.append(document.createTextNode(source.slice(last, match.index)));
    last = match.index + token.length;

    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      target.append(code);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      const strong = document.createElement("strong");
      renderInline(strong, token.slice(2, -2));
      target.append(strong);
    } else if (token.startsWith("~~")) {
      const del = document.createElement("del");
      renderInline(del, token.slice(2, -2));
      target.append(del);
    } else if (token.startsWith("[")) {
      const cut = token.indexOf("](");
      target.append(makeLink(token.slice(cut + 2, -1), token.slice(1, cut)));
    } else if (/^(https?:\/\/|www\.)/.test(token)) {
      target.append(makeLink(token, token));
    } else {
      const em = document.createElement("em");
      renderInline(em, token.slice(1, -1));
      target.append(em);
    }
  }

  if (last < source.length) target.append(document.createTextNode(source.slice(last)));
  return target;
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
  copy.setAttribute("aria-label", "Copier le code");
  copy.append(svgIcon("i-copy"), document.createTextNode("Copier"));
  copy.addEventListener("click", () => copyToClipboard(code, copy));
  head.append(lang, copy);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  pre.append(codeEl);

  wrap.append(head, pre);
  return wrap;
}

function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

/** Transforme du Markdown en DOM dans `container`. */
export function renderMarkdown(container, source) {
  container.replaceChildren();
  container.classList.add("rich");

  const lines = String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n");

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloc de code ```langage … ```
    const fence = line.match(/^\s*```+\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const buffer = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) buffer.push(lines[i++]);
      i++; // consomme la clôture (ou la fin du flux)
      container.append(makeCodeBlock(fence[1], buffer.join("\n")));
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // Séparateur horizontal
    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      container.append(document.createElement("hr"));
      i++;
      continue;
    }

    // Titres (## / ###…) — h1 est réservé à l'accueil.
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(Math.max(heading[1].length, 2), 4);
      const h = document.createElement(`h${level}`);
      renderInline(h, heading[2].replace(/\s*#+\s*$/, ""));
      container.append(h);
      i++;
      continue;
    }

    // Tableau Markdown
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const headCells = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));

      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      const table = document.createElement("table");

      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const cell of headCells) {
        const th = document.createElement("th");
        renderInline(th, cell);
        headRow.append(th);
      }
      thead.append(headRow);

      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          renderInline(td, cell);
          tr.append(td);
        }
        tbody.append(tr);
      }

      table.append(thead, tbody);
      wrap.append(table);
      container.append(wrap);
      continue;
    }

    // Citation
    if (/^\s*>\s?/.test(line)) {
      const buffer = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buffer.push(lines[i++].replace(/^\s*>\s?/, ""));
      const quote = document.createElement("blockquote");
      renderInline(quote, buffer.join(" "));
      container.append(quote);
      continue;
    }

    // Listes à puces ou numérotées
    if (BULLET_RX.test(line) || ORDERED_RX.test(line)) {
      const isOrdered = ORDERED_RX.test(line);
      const list = document.createElement(isOrdered ? "ol" : "ul");
      if (isOrdered) {
        const startAt = Number(line.match(ORDERED_RX)[1]);
        if (Number.isFinite(startAt) && startAt !== 1) list.start = startAt;
      }

      while (i < lines.length) {
        const match = isOrdered ? lines[i].match(ORDERED_RX) : lines[i].match(BULLET_RX);
        if (!match) break;
        i++;

        const parts = [match[2]];
        // Lignes de continuation indentées rattachées au même point.
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !BULLET_RX.test(lines[i]) &&
          !ORDERED_RX.test(lines[i])
        ) {
          parts.push(lines[i++].trim());
        }

        const li = document.createElement("li");
        renderInline(li, parts.join(" "));
        list.append(li);
      }

      container.append(list);
      continue;
    }

    // Paragraphe
    const buffer = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*#{1,6}\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !BULLET_RX.test(lines[i]) &&
      !ORDERED_RX.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      buffer.push(lines[i++].trim());
    }

    const p = document.createElement("p");
    p.style.whiteSpace = "pre-line";
    renderInline(p, buffer.join("\n"));
    container.append(p);
  }

  // Filet de sécurité : jamais de bulle vide, la réponse s'affiche toujours.
  if (!container.childNodes.length) container.textContent = String(source ?? "");
  return container;
}
