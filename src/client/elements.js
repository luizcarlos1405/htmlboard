// An element of a design, named so an agent can find it: a short CSS selector that matches it and
// nothing else, and a bit of its text. The element picked on the canvas (htmlboard state) and the
// rows of htmlboard inspect are named this way, so what they say goes straight into shot --selector.

// A class that needs no escaping (md:flex and w-1/2 do, and say little anyway)
const PLAIN = /^-?[_a-zA-Z][\w-]*$/;

/**
 * The shortest selector that finds `el` and nothing else in its page: its own name (an id, or its tag
 * and first classes, which div and span go without), with the child it is when that's needed, after
 * one element around it when that's needed; else its path from the nearest id, or the body.
 */
export function selectorOf(el) {
  const doc = el.ownerDocument;
  if (el === doc.documentElement) return 'html';
  if (el === doc.body) return 'body';
  const only = (selector) => {
    try {
      const found = doc.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  };
  // How a node can be named: by an id no other element has; else by its tag and classes, alone or
  // with the child it is
  const names = (node) => {
    if (node.id && doc.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) return [`#${CSS.escape(node.id)}`];
    const classes = [...node.classList].filter((name) => PLAIN.test(name)).slice(0, 2).map((name) => `.${name}`).join('');
    const base = classes && (node.localName === 'div' || node.localName === 'span') ? classes : `${node.localName}${classes}`;
    const index = node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1;
    return [base, `${base}:nth-child(${index})`];
  };
  const own = names(el);
  for (const name of own) if (only(name)) return name;
  for (let around = el.parentElement; around && around !== doc.documentElement; around = around.parentElement) {
    for (const outer of names(around)) {
      for (const name of own) if (only(`${outer} ${name}`)) return `${outer} ${name}`;
    }
  }
  // Its whole path, each step the child it is, from the nearest id or the body: its shortest end
  // that still finds only it, else all of it
  const path = [];
  for (let node = el; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    const [base, nth = base] = names(node);
    path.unshift(nth);
    if (base.startsWith('#')) break;
  }
  for (let start = path.length - 2; start > 0; start--) {
    const end = path.slice(start).join(' ');
    if (only(end)) return end;
  }
  return path[0].startsWith('#') ? path.join(' > ') : `body > ${path.join(' > ')}`;
}

/** A bit of what an element says: its text, else its label, alt text or placeholder */
export function textOf(el, most = 40) {
  const said = (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
    || ['aria-label', 'alt', 'placeholder', 'title'].map((name) => el.getAttribute?.(name)).find(Boolean)
    || (typeof el.value === 'string' ? el.value : '');
  return said.length > most ? `${said.slice(0, most - 1)}…` : said;
}
