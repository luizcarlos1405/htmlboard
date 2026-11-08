// Themes: the canvas shows every design in one (its theme switch), and check and shot load a design in
// one (--theme). A theme is a value of an attribute on the page's <html> (`data-theme="dark"` by
// default; designs.json or <meta name="htmlboard:themes"> can name another, or "class"), and light and
// dark are also the system's: the frame's color-scheme, which pages that follow prefers-color-scheme
// or use light-dark() see. probe.js sets the same as the page starts (see setTheme there).

/** The values the system's own light and dark modes have */
export const SCHEMES = new Set(['light', 'dark']);

/**
 * The theme to set in a design's page: `{ attribute, value, values }`, from how the design's themes
 * apply (`config`: designs.json's or the design's own, else data-theme) and the theme's name; null for
 * the page's own.
 */
export function themeFor(config, value) {
  if (!value) return null;
  return { attribute: config?.attribute || 'data-theme', value, values: config?.values || [] };
}

/**
 * Shows the page of `frame` (an iframe) in `theme`, and marks the frame so its page starts in it the
 * next time it loads (probe.js reads the mark). `own`: what the frame shows with no theme, the system's
 * mode (the canvas) or light (check and shot, which see the same everywhere).
 */
export function showTheme(frame, theme, { own = '' } = {}) {
  if (theme) frame.dataset.htmlboardTheme = JSON.stringify(theme);
  else delete frame.dataset.htmlboardTheme;
  frame.style.colorScheme = theme && SCHEMES.has(theme.value) ? theme.value : own;
  try {
    const root = frame.contentDocument?.documentElement;
    if (root && theme) setTheme(root, theme);
  } catch {
    // Another site's page
  }
}

/** Sets the theme on a page's <html> (the same as probe.js does) */
export function setTheme(root, { attribute, value, values = [] }) {
  if (attribute === 'class') {
    for (const other of values) if (other !== value) root.classList.remove(other);
    root.classList.add(value);
  } else {
    root.setAttribute(attribute, value);
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The themes a page's stylesheets have: the values their selectors give the attribute (`[data-theme=
 * "dark"]`; for "class", the classes of `html` or `:root`), and light and dark when they follow the
 * system's (prefers-color-scheme, light-dark(), color-scheme: light dark). Stylesheets from another
 * site that doesn't allow reading them are left out.
 */
export function themesOf(doc, attribute = 'data-theme') {
  const found = new Set();
  let scheme = false;
  const selector = attribute === 'class'
    ? /(?:^|[\s,>+~(])(?:html|:root)((?:\.[\w-]+)+)/g
    : new RegExp(`\\[\\s*${escapeRegExp(attribute)}\\s*[~|^$*]?=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s\\]]+))`, 'gi');
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText) {
        for (const match of rule.selectorText.matchAll(selector)) {
          if (attribute === 'class') for (const name of match[1].split('.').filter(Boolean)) found.add(name);
          else found.add(match[1] ?? match[2] ?? match[3]);
        }
      }
      if (/prefers-color-scheme/i.test(rule.media?.mediaText || rule.conditionText || '')) scheme = true;
      else if (rule.style && /light-dark\(|color-scheme:\s*(light\s+dark|dark\s+light)/i.test(rule.cssText)) scheme = true;
      if (rule.cssRules) visit(rule.cssRules);
    }
  };
  for (const sheet of [...doc.styleSheets, ...(doc.adoptedStyleSheets || [])]) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Another site's, which the page can use but not read
    }
  }
  if (scheme) {
    found.add('light');
    found.add('dark');
  }
  return [...found].filter(Boolean);
}

/** Themes in the order a switch shows them: light, dark, then the others as found */
export function inOrder(values) {
  const unique = [...new Set(values)];
  return [...['light', 'dark'].filter((value) => unique.includes(value)), ...unique.filter((value) => !SCHEMES.has(value))];
}
