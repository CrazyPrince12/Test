// Tests du rendu enrichi des réponses (public/markdown.js).
//
// Objectif produit : la réponse de l'API doit s'afficher EN ENTIER et
// reformatée (titres, listes, tableaux, code, gras…), sans jamais passer par
// innerHTML. Ces tests utilisent un DOM minimal maison : aucune dépendance.

import { test } from "node:test";
import assert from "node:assert/strict";

/* ------------------------------ DOM minimal ------------------------------ */

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      contains: (n) => this.classes.has(n),
    };
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return [...this.classes].join(" ");
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener() {}

  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  set textContent(value) {
    this.children = [{ nodeType: 3, text: String(value) }];
  }

  get childNodes() {
    return this.children;
  }

  get textContent() {
    return this.children
      .map((c) => (c.nodeType === 3 ? c.text : c.textContent))
      .join("");
  }
}

function installFakeDom() {
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (_ns, tag) => new FakeNode(tag),
    createTextNode: (text) => ({ nodeType: 3, text: String(text) }),
  };
}

installFakeDom();
const { renderMarkdown } = await import("../public/markdown.js");

function serialize(node) {
  if (node.nodeType === 3) return node.text;
  const inner = node.children.map(serialize).join("");
  return `<${node.tag}>${inner}</${node.tag}>`;
}

function render(markdown) {
  const container = new FakeNode("div");
  renderMarkdown(container, markdown);
  return { container, html: container.children.map(serialize).join("") };
}

/* --------------------------------- Tests --------------------------------- */

test("markdown : titres, gras, italique et code en ligne", () => {
  const { html } = render("## Titre\n\nUn **mot** en gras, un *mot* en italique et `du code`.");
  assert.match(html, /<h2>Titre<\/h2>/);
  assert.match(html, /<strong>mot<\/strong>/);
  assert.match(html, /<em>mot<\/em>/);
  assert.match(html, /<code>du code<\/code>/);
});

test("markdown : listes à puces et numérotées", () => {
  const { html } = render("- un\n- deux\n\n1. premier\n2. second");
  assert.match(html, /<ul><li>un<\/li><li>deux<\/li><\/ul>/);
  assert.match(html, /<ol><li>premier<\/li><li>second<\/li><\/ol>/);
});

test("markdown : tableau converti en vraie table", () => {
  const { html } = render("| Pays | Ville |\n|---|---|\n| Cameroun | Douala |");
  assert.match(html, /<table>/);
  assert.match(html, /<th>Pays<\/th><th>Ville<\/th>/);
  assert.match(html, /<td>Cameroun<\/td><td>Douala<\/td>/);
});

test("markdown : bloc de code conservé tel quel avec son langage", () => {
  const { container } = render("```js\nconst a = 1;\nconsole.log(a);\n```");
  const block = container.children[0];
  assert.ok(block.classList.contains("code-block"));
  assert.match(block.textContent, /js/);
  assert.match(block.textContent, /const a = 1;\nconsole\.log\(a\);/);
});

test("markdown : la réponse est affichée en entier (rien n'est perdu)", () => {
  const reply = [
    "## Plan",
    "",
    "Voici la marche à suivre :",
    "",
    "1. Cloner le dépôt",
    "2. Installer les dépendances",
    "",
    "> Astuce : lis le README.",
    "",
    "```bash",
    "npm install",
    "```",
    "",
    "Fin de la réponse.",
  ].join("\n");

  const { container, html } = render(reply);
  for (const fragment of [
    "Plan",
    "Voici la marche à suivre",
    "Cloner le dépôt",
    "Installer les dépendances",
    "Astuce : lis le README.",
    "npm install",
    "Fin de la réponse.",
  ]) {
    assert.ok(container.textContent.includes(fragment), `fragment manquant : ${fragment}`);
  }
  assert.match(html, /<blockquote>/);
});

test("markdown : aucun HTML injecté par le modèle n'est interprété", () => {
  const { container, html } = render('<img src=x onerror="alert(1)"> **ok**');
  assert.ok(!html.includes("<img>"), "aucune balise img ne doit être créée");
  assert.ok(container.textContent.includes('<img src=x onerror="alert(1)"'));
  assert.match(html, /<strong>ok<\/strong>/);
});

test("markdown : liens Markdown et URL nues deviennent des liens", () => {
  const { container } = render("Doc : [ici](https://example.com) et https://exemple.org/page");
  const links = [];
  const walk = (node) => {
    if (node.nodeType === 3) return;
    if (node.tag === "a") links.push(node);
    node.children.forEach(walk);
  };
  container.children.forEach(walk);
  assert.equal(links.length, 2);
  assert.equal(links[0].href, "https://example.com");
  assert.equal(links[1].textContent, "https://exemple.org/page");
});

test("markdown : texte simple sans balisage reste intact", () => {
  const { container } = render("Bonjour, je suis Venice.");
  assert.equal(container.textContent, "Bonjour, je suis Venice.");
});
