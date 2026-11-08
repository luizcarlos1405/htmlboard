import path from 'node:path';
import { CanvasError, canvasFor, askCanvas } from './canvases.js';

// `htmlboard check`: the canvas running for a folder, open in a browser, loads its designs and says
// what went wrong in each (see client/check.js); this finds that canvas, asks it, and puts the
// answer in a few lines of text.

/** A problem the check couldn't get past (no canvas running, none open in a browser): exit code 2 */
export { CanvasError as CheckError };

/**
 * Check designs with the canvas that shows them: a designs folder, a folder in it, or a design's
 * file (default: all the designs of the canvas found). The canvas must be open in a browser, where
 * the check runs.
 *
 * @param {string} [target] A path; without one, the canvas's whole folder (looked for from the current one)
 * @param {object} [options]
 * @param {number} [options.port] The canvas's port (default: looked for on 3000 to 3020)
 * @returns {Promise<{canvas: object, report: object}>} The canvas (its url, dir, root) and its report
 */
export async function runCheck(target, { port } = {}) {
  const { canvas, only } = await canvasFor(target, { port });
  const answer = await askCanvas(canvas, `/api/check${only ? `?only=${encodeURIComponent(only)}` : ''}`, 'the check');
  if (answer.status !== 200) throw new CanvasError(`${answer.error || `The canvas answered ${answer.status}`}.`);
  const { status, ...report } = answer;
  return { canvas, report };
}

const LEVELS = ['error', 'layout', 'note'];
// The page as a whole first, then its scripts, its components and its files
const KINDS = ['blank', 'timeout', 'check', 'script', 'console', 'component', 'missing', 'load', 'font', 'beyond', 'cut', 'spill', 'below'];

/** Whether the report has something to fix (notes aside) */
export const hasProblems = (report) => report.designs.some((design) => design.problems.some((problem) => problem.level !== 'note'));

/**
 * The report as text: the designs with problems, each followed by its problems (errors, then
 * layout, then notes), with paths from the designs folder.
 *
 * @param {object} report What runCheck returns as `report` (or GET /api/check answers)
 * @param {object} [options]
 * @param {string} [options.name] How to call the designs folder (default: its path)
 * @param {string} [options.url] The canvas's address, to say where the check ran
 */
export function formatReport(report, { name = report.dir, url } = {}) {
  const prefix = path.relative(report.root, report.dir).split(path.sep).join('/');
  // A path from the server's root ("/design/app.js"), from the designs folder instead ("app.js")
  const show = (file) => {
    const bare = String(file).replace(/^\/+/, '');
    return prefix ? path.posix.relative(prefix, bare) : bare;
  };
  const designs = report.designs;
  const failing = designs.filter((design) => design.problems.some((problem) => problem.level !== 'note')).length;
  const noted = designs.filter((design) => design.problems.length && design.problems.every((problem) => problem.level === 'note')).length;
  const lines = [`Checked ${count(designs.length, 'design')} in ${name}${url ? ` (the canvas at ${url})` : ''}: ${
    failing ? `${failing} with problems` : 'no problems found'}${noted ? `, ${noted} with notes` : ''}.`];
  const order = (problem) => LEVELS.indexOf(problem.level) * KINDS.length + KINDS.indexOf(problem.kind);
  for (const design of designs.filter((d) => d.problems.length)) {
    lines.push('', `${show(design.file)}${design.title ? ` · ${design.title}` : ''}`);
    for (const problem of [...design.problems].sort((a, b) => order(a) - order(b))) {
      lines.push(`  ${problem.level.padEnd(6)} ${describe(problem, show)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** A problem in words (see client/check.js for what each kind holds) */
function describe(problem, show) {
  const times = problem.count > 1 ? ` (${problem.count} times)` : '';
  const file = problem.path ? show(problem.path) : problem.url;
  switch (problem.kind) {
    case 'script': {
      const source = problem.source ? (problem.source.startsWith('/') ? show(problem.source) : problem.source) : '';
      return `${problem.message}${source ? ` (${source}${problem.line ? `:${problem.line}` : ''})` : ''}${times}`;
    }
    case 'console':
      return `console.error: ${problem.message}${times}`;
    case 'missing':
      return `missing file: ${file}${problem.tag ? ` (<${problem.tag}>)` : ''}${times}`;
    case 'load':
      return file ? `<${problem.tag}> couldn't load ${file}${times}` : `<${problem.tag}> has nothing to load${times}`;
    case 'font':
      return `font "${problem.family}" didn't load`;
    case 'component':
      if (problem.loader === false) return `<${problem.tag}> isn't built: the page doesn't load components.js`;
      if (problem.found === false) return `<${problem.tag}> isn't built: there is no ${file}`;
      return `<${problem.tag}> isn't built, though ${file || 'its file'} is there (see the errors)`;
    case 'blank':
      return 'the page shows nothing';
    case 'timeout':
      return `still loading after ${problem.seconds} s, checked as it was`;
    case 'beyond':
      return `cut at the right edge (the frame is ${problem.frame} px wide): ${problem.elements
        .map((element) => `${element.selector} reaches ${element.right}`).join(', ')}${problem.more ? `, and ${problem.more} more` : ''}`;
    case 'cut':
      if (problem.more) return `and ${moreBoxes(problem.more)} cut text off`;
      return `text cut off by ${problem.selector} (overflow: ${problem.overflow}): "${problem.text}"${problem.count > 1 ? ` and ${problem.count - 1} more` : ''}`;
    case 'spill':
      if (problem.more) return `and ${moreBoxes(problem.more)} with text spilling out`;
      return `text spills out of ${problem.selector}: "${problem.text}"${problem.count > 1 ? ` and ${problem.count - 1} more` : ''}`;
    case 'below':
      return `content goes on below the frame, down to ${problem.bottom} px (the frame is ${problem.frame} px tall)`;
    case 'check':
      return `couldn't check it: ${problem.message}`;
    default:
      return JSON.stringify(problem);
  }
}

function count(n, what) {
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

const moreBoxes = (n) => `${n} more ${n === 1 ? 'box' : 'boxes'}`;
