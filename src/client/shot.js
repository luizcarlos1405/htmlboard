// Shots (`htmlboard shot`): a design, or one element of it, as a PNG for an agent to look at. The
// design loads afresh, out of sight, in a frame of its size (as tall as its page when it has no height
// of its own), as the check loads it; once it has settled, picture.js draws it, cropped to the
// element's box and scaled.

import { hiddenBox, openDesign } from './check.js';
import { drawDesign } from './picture.js';

const DEFAULT_SIZE = [1200, 800]; // as the canvas: a design whose entry gives no size
const FIT_HEIGHT = 100; // a frame that fits its page however short (a component's) starts this tall

/** What the agent asked for can't be shot (a selector that matches nothing): not the canvas's fault */
export class ShotError extends Error {}

/**
 * A design as a PNG: `{ png, width, height, matches }` (png: base64; matches: how many elements the
 * selector matched, the first one shot).
 *
 * @param {object} request
 * @param {{ file: string, width?: number, height?: number, fit?: boolean }} request.design
 * @param {string} [request.selector] Only this element: the first the CSS selector matches
 * @param {number} [request.max] The longest side at most this many px
 * @param {number} [request.scale] px per CSS px (default 1; ignored with max)
 */
export async function shotDesign({ design, selector, max, scale }) {
  const width = Number(design.width) || DEFAULT_SIZE[0];
  const height = Number(design.height) || 0;
  const box = hiddenBox();
  try {
    const page = await openDesign({
      file: design.file,
      width,
      height,
      frameHeight: height || (design.fit ? FIT_HEIGHT : DEFAULT_SIZE[1]),
    }, box, { grow: true });
    if (!page.doc) throw new Error('the page shows nothing');
    const frame = { width, height: parseFloat(page.frame.style.height) };
    let area = { x: 0, y: 0, ...frame };
    let matches = 0;
    if (selector) {
      let found;
      try {
        found = page.doc.querySelectorAll(selector);
      } catch {
        throw new ShotError(`${selector} isn't a CSS selector`);
      }
      matches = found.length;
      if (!matches) throw new ShotError(`nothing in the page matches ${selector}`);
      const rect = found[0].getBoundingClientRect();
      area = clip(rect, frame);
      if (!area) {
        throw new ShotError(!rect.width || !rect.height
          ? `${selector} has no size (hidden, or empty)`
          : `${selector} is outside the frame (at ${Math.round(rect.left)}, ${Math.round(rect.top)}; the frame is ${frame.width} × ${frame.height})`);
      }
    }
    const factor = max ? Math.min(1, max / Math.max(area.width, area.height)) : Number(scale) || 1;
    const canvas = await drawDesign(page.frame, {
      ...frame,
      scale: factor,
      crop: selector ? area : null,
      fresh: true,
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the image is too big');
    return { png: await base64(blob), width: canvas.width, height: canvas.height, matches };
  } finally {
    box.remove();
  }
}

/** A box within the frame, whole pixels around it; null when nothing of it is in the frame */
function clip(rect, frame) {
  const left = Math.max(0, Math.floor(rect.left));
  const top = Math.max(0, Math.floor(rect.top));
  const right = Math.min(frame.width, Math.ceil(rect.right));
  const bottom = Math.min(frame.height, Math.ceil(rect.bottom));
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
