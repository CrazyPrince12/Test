// Petites aides DOM partagées par l'interface Venice.
// Aucun emoji : les icônes viennent du sprite SVG défini dans index.html.

export function svgIcon(id, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

/** Copie un texte dans le presse-papiers ; met à jour le libellé du bouton. */
export async function copyToClipboard(text, button) {
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

  const label = button?.lastChild;
  if (label && label.nodeType === 3) {
    const original = label.textContent;
    label.textContent = ok ? "Copié" : "Erreur";
    setTimeout(() => {
      label.textContent = original;
    }, 1600);
  }
  return ok;
}
