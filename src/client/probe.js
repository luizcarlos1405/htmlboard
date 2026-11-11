// probe.js: the server puts it first in the <head> of the pages shown in frames, so it runs before
// anything else in them.

// Every file the page loads is listed, not only the first 250: a picture of it notes them all, to be
// made again when one of them changes (see pictures.js)
try {
  performance.setResourceTimingBufferSize(100000);
} catch {
  // An older browser: the first 250
}
//
// The theme the canvas shows the page in (its theme switch, check and shot --theme), which its frame
// says: set on <html> before the page's own scripts run, so they see it (see client/theme.js).
(() => {
  try {
    const theme = JSON.parse(window.frameElement?.dataset.htmlboardTheme || 'null');
    if (!theme?.attribute || !theme.value) return;
    const root = document.documentElement;
    if (theme.attribute === 'class') {
      for (const other of theme.values || []) if (other !== theme.value) root.classList.remove(other);
      root.classList.add(theme.value);
    } else {
      root.setAttribute(theme.attribute, theme.value);
    }
  } catch {
    // Not in a frame of the canvas's
  }
})();

// What goes wrong while a design's page builds (script errors, console.error, files that don't
// load), for `htmlboard check`, heard from the start. Only in the frames the check loads (named
// htmlboard-check): the canvas's own frames, and a page opened on its own, are left as they are.
(() => {
  if (window.name !== 'htmlboard-check') return;
  const MOST = 100;
  const problems = [];
  const note = (problem) => {
    if (problems.length < MOST) problems.push(problem);
  };
  const describe = (value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  // Capturing: an element's failed load (an <img>, a <script>, a <link>) doesn't bubble
  addEventListener('error', (event) => {
    const { target } = event;
    if (target instanceof Element) {
      const url = [target.currentSrc, target.src, target.href, target.href?.baseVal].find((value) => typeof value === 'string');
      note({ kind: 'load', tag: target.localName, url: url || '' });
    } else {
      const message = event.message || describe(event.error);
      note({ kind: 'script', message: message.replace(/^Uncaught /, ''), source: event.filename || '', line: event.lineno || 0 });
    }
  }, true);
  addEventListener('unhandledrejection', (event) => {
    note({ kind: 'script', message: `(in a promise) ${describe(event.reason)}`, source: '', line: 0 });
  });
  const error = console.error;
  console.error = function (...args) {
    note({ kind: 'console', message: args.map(describe).join(' ') });
    return error.apply(this, args);
  };
  Object.defineProperty(window, '__htmlboard', { value: Object.freeze({ problems }) });
})();
