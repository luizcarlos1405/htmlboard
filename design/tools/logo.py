"""Draws the htmlboard logo and writes its SVG files.

The logo is "Hanging row" (picked on 2026-10-28 from the five options in design/logo-options.html):
designs of different sizes hanging side by side from a line, tops aligned, as the canvas lays them
out. The wordmark is "htmlboard" in Bricolage Grotesque 800 (the explorer's display face, bundled in
src/client/fonts), "html" soft and "board" strong, turned into outlines with HarfBuzz's kerning so
the files need no font.

Run from the repository root (the tools live outside the package, in a throwaway venv):

    python3 -m venv /tmp/htmlboard-logo
    /tmp/htmlboard-logo/bin/pip install fonttools brotli uharfbuzz
    /tmp/htmlboard-logo/bin/python design/tools/logo.py

It writes brand/ (the files for the README and anywhere else), src/client/{favicon,logo,mark}.svg
(the explorer's) and design/logo.html (the logo's board: `npx htmlboard design --root .`).
"""

import io
import os

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.path.join(ROOT, 'src', 'client', 'fonts', 'bricolage-grotesque.woff2')
FONT_AXES = {'opsz': 48, 'wght': 800}
TRACKING = -6  # thousandths of an em

# The explorer's colours (src/client/explorer.css), and their counterparts on light backgrounds
INK = '#1C1C1E'
THEMES = {
    'dark': {'boards': '#FFFFFF', 'line': '#9D9DA3', 'pegs': '#3D9DFF', 'html': '#9D9DA3', 'board': '#FFFFFF'},
    'light': {'boards': INK, 'line': '#8E8E93', 'pegs': '#1F86F5', 'html': '#8E8E93', 'board': INK},
}


def num(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def rect(x, y, w, h, r, fill):
    return f'<rect x="{num(x)}" y="{num(y)}" width="{num(w)}" height="{num(h)}" rx="{num(r)}" fill="{fill}"/>'


# ---------------------------------------------------------------- the mark

# On a 32-unit grid: the line, a phone and a desktop hanging from it, two pegs
MARK_BOX = (1.75, 5.25, 28.5, 22.5)  # its ink, with a hair of room for antialiasing


def mark(theme):
    c = THEMES[theme]
    return (rect(2, 7.4, 28, 1.2, 0.6, c['line'])
            + rect(4.5, 10.5, 9, 17, 1.6, c['boards'])
            + rect(16, 10.5, 12, 8.5, 1.6, c['boards'])
            + rect(8.1, 5.5, 1.8, 6.5, 0.9, c['pegs'])
            + rect(21.1, 5.5, 1.8, 6.5, 0.9, c['pegs']))


# The same on a 16-unit grid with every edge on a whole pixel, for 16 px (and crisp at 32 px)
def mark_px(theme):
    c = THEMES[theme]
    return (rect(1, 3, 14, 1, 0.5, c['line'])
            + rect(2, 5, 5, 9, 0.8, c['boards'])
            + rect(8, 5, 7, 4, 0.8, c['boards'])
            + rect(4, 2, 1, 4, 0.5, c['pegs'])
            + rect(11, 2, 1, 4, 0.5, c['pegs']))


def svg(view_box, width, height, inner, title='htmlboard'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" width="{num(width)}" height="{num(height)}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{inner}</svg>\n')


def mark_svg(theme, size):
    x, y, w, h = MARK_BOX
    return svg(f'{num(x)} {num(y)} {num(w)} {num(h)}', size * w / h, size, mark(theme))


def icon_svg(size):
    """The app icon: the mark on the canvas's dark tile."""
    return svg('0 0 32 32', size, size, rect(0, 0, 32, 32, 7, INK)
               + f'<g transform="translate(2.56 2.56) scale(0.84)">{mark("dark")}</g>')


def favicon_svg():
    return svg('0 0 16 16', 16, 16, rect(0, 0, 16, 16, 3.5, INK) + mark_px('dark'))


# ---------------------------------------------------------------- the wordmark

_font = None


def font():
    global _font
    if _font is None:
        static = instantiateVariableFont(TTFont(FONT), FONT_AXES)
        static.flavor = None
        data = io.BytesIO()
        static.save(data)
        _font = (static, data.getvalue())
    return _font


def wordmark(theme, size):
    """'htmlboard' at font size `size`, baseline at y=0: (svg paths, width, ascender height)."""
    static, data = font()
    buf = hb.Buffer()
    buf.add_str('htmlboard')
    buf.guess_segment_properties()
    hb.shape(hb.Font(hb.Face(data)), buf, {'kern': True})
    upm = static['head'].unitsPerEm
    scale = size / upm
    glyphs = static.getGlyphSet()
    order = static.getGlyphOrder()
    bounds = BoundsPen(glyphs)
    paths = []
    x = 0
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = order[info.codepoint]
        transform = (scale, 0, 0, -scale, (x + pos.x_offset) * scale, 0)
        pen = SVGPathPen(glyphs, ntos=num)
        glyphs[name].draw(TransformPen(pen, transform))
        glyphs[name].draw(TransformPen(bounds, transform))
        colour = THEMES[theme]['html' if i < 4 else 'board']
        paths.append(f'<path d="{pen.getCommands()}" fill="{colour}"/>')
        x += pos.x_advance + TRACKING * upm / 1000
    x0, y0, x1, y1 = bounds.bounds
    return ''.join(paths), x1, -y0


def lockup_svg(theme, height):
    """The mark `height` px tall, then the wordmark, its ascenders two thirds of it, centred on it."""
    _, _, probe = wordmark(theme, 100)
    size = height * 0.66 / (probe / 100)
    words, words_w, ascender = wordmark(theme, size)
    x, y, w, h = MARK_BOX
    mark_w = height * w / h
    gap = height * 0.3
    width = mark_w + gap + words_w
    inner = (f'<svg x="0" y="0" width="{num(mark_w)}" height="{num(height)}" viewBox="{num(x)} {num(y)} {num(w)} {num(h)}">'
             f'{mark(theme)}</svg>'
             f'<g transform="translate({num(mark_w + gap)} {num((height + ascender) / 2)})">{words}</g>')
    return svg(f'0 0 {num(width)} {num(height)}', width, height, inner)


# ---------------------------------------------------------------- the board

BOARD = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Logo · Hanging row</title>
  <meta name="htmlboard" content="width=1200">
  <link rel="stylesheet" href="brand.css">
</head>
<body>
  <main class="board">
    <header>
      <p class="kicker">htmlboard logo · picked 2026-10-28 (the other options: design/logo-options.html)</p>
      <h1>Hanging row</h1>
      <p class="idea">The canvas’s rows: designs of every size hanging side by side, tops aligned, like sketches pegged to a line to look at together. The wordmark is Bricolage Grotesque 800, “html” soft and “board” strong. Every file below comes from design/tools/logo.py.</p>
    </header>
    <section class="pair">
      <div class="tile dark"><img src="../brand/mark-dark.svg" height="160" alt=""></div>
      <div class="tile light"><img src="../brand/mark-light.svg" height="160" alt=""></div>
    </section>
    <section class="pair">
      <div class="tile dark lock"><img src="../brand/logo-dark.svg" height="56" alt=""></div>
      <div class="tile light lock"><img src="../brand/logo-light.svg" height="56" alt=""></div>
    </section>
    <section class="sizes">
      <figure><div class="icons"><img src="../brand/icon.svg" width="128" height="128" alt=""><img src="../brand/icon.svg" width="64" height="64" alt=""></div><figcaption>App icon (128, 64)</figcaption></figure>
      <figure><div class="favs"><span class="on-light"><img src="../brand/icon.svg" width="32" height="32" alt=""><img src="../brand/favicon.svg" width="16" height="16" alt=""></span><span class="on-dark"><img src="../brand/icon.svg" width="32" height="32" alt=""><img src="../brand/favicon.svg" width="16" height="16" alt=""></span></div><figcaption>Favicons (32, 16), real size</figcaption></figure>
      <figure class="grow"><div class="tabs">
        <div class="strip light"><div class="tab"><img src="../brand/favicon.svg" width="16" height="16" alt=""><span>NOS Dourados · Designs · htmlboard</span><b>×</b></div></div>
        <div class="strip dark"><div class="tab"><img src="../brand/favicon.svg" width="16" height="16" alt=""><span>NOS Dourados · Designs · htmlboard</span><b>×</b></div></div>
      </div><figcaption>In a browser tab</figcaption></figure>
    </section>
    <section class="files">
      <h2>Files</h2>
      <dl>
        <div><dt>brand/logo-light.svg, brand/logo-dark.svg</dt><dd>The logo (mark and wordmark), on light and on dark backgrounds: the README, docs, slides.</dd></div>
        <div><dt>brand/mark-light.svg, brand/mark-dark.svg</dt><dd>The mark alone, where the name is already said.</dd></div>
        <div><dt>brand/icon.svg</dt><dd>The app icon: the mark on the canvas’s dark tile.</dd></div>
        <div><dt>brand/favicon.svg, src/client/favicon.svg</dt><dd>The tab icon, drawn on whole pixels for 16 px.</dd></div>
        <div><dt>src/client/logo.svg, src/client/mark.svg</dt><dd>The explorer’s: the logo at the top of the list, the mark in its empty state.</dd></div>
      </dl>
    </section>
  </main>
</body>
</html>
'''


def write(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as f:
        f.write(text)
    print('wrote', path)


if __name__ == '__main__':
    write('brand/logo-light.svg', lockup_svg('light', 64))
    write('brand/logo-dark.svg', lockup_svg('dark', 64))
    write('brand/mark-light.svg', mark_svg('light', 64))
    write('brand/mark-dark.svg', mark_svg('dark', 64))
    write('brand/icon.svg', icon_svg(128))
    write('brand/favicon.svg', favicon_svg())
    write('src/client/favicon.svg', favicon_svg())
    write('src/client/logo.svg', lockup_svg('dark', 18))
    write('src/client/mark.svg', mark_svg('dark', 72))
    write('design/logo.html', BOARD)
