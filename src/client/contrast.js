// Contrast between a text's colour and its background, as WCAG measures it: the ratio of their
// relative luminances, from 1:1 (the same) to 21:1 (black on white). AA asks for 4.5:1, or 3:1 for
// large text (24 px, or 18.66 px and bold). Colours are [r, g, b, a] in sRGB: r, g, b from 0 to 255
// and a (alpha) from 0 to 1. Nothing here touches a page, so these run anywhere.

/** A colour's relative luminance (WCAG 2): 0 for black to 1 for white */
export function luminance([r, g, b]) {
  const linear = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio of two opaque colours, 1 to 21 */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** A colour with alpha painted over another: what shows */
export function over(top, bottom) {
  const alpha = top[3] ?? 1;
  const under = bottom[3] ?? 1;
  const shown = alpha + under * (1 - alpha);
  if (!shown) return [0, 0, 0, 0];
  const mix = (i) => (top[i] * alpha + bottom[i] * under * (1 - alpha)) / shown;
  return [mix(0), mix(1), mix(2), shown];
}

/** The ratio a text needs (AA): 3 for large text (24 px, or 18.66 px and bold), else 4.5 */
export function needs(fontSize, fontWeight) {
  const size = parseFloat(fontSize) || 0;
  const bold = (parseInt(fontWeight, 10) || 400) >= 700;
  return size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
}

/** A ratio as the report says it: one decimal, never rounded up to what it needs (4.47 is 4.4) */
export const shownRatio = (ratio) => Math.floor(ratio * 10) / 10;

/** An opaque colour as #rrggbb */
export const hex = ([r, g, b]) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
