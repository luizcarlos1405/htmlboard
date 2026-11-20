import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What htmlboard installs in a project (the agent skills) is recorded in a
// .htmlboard-lock.json beside it: the version that wrote it and the sha256 of each file. A copy whose
// files still have those hashes is out of date at most, so the next install updates it; one whose files
// don't was edited, and is kept.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

export const LOCK_FILE = '.htmlboard-lock.json';

/**
 * A file's sha256, what `sha256sum` prints for it. Line endings don't count: a checkout that turns
 * them into CRLF (Git on Windows) hasn't edited the file.
 */
export function hashFile(file) {
  const content = fs.readFileSync(file, 'latin1').replaceAll('\r\n', '\n');
  return crypto.createHash('sha256').update(content, 'latin1').digest('hex');
}

/** The lock in dir, `{ htmlboard: version, files: { name: sha256 } }`, or null if there's none */
export function readLock(dir) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8'));
    return lock?.files && typeof lock.files === 'object' ? lock : null;
  } catch {
    return null;
  }
}

/** Write the lock in dir: these files ({ name: sha256 }), as this htmlboard wrote them */
export function writeLock(dir, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(path.join(dir, LOCK_FILE), `${JSON.stringify({ htmlboard: VERSION, files: sorted }, null, 2)}\n`);
}

/** Whether two sets of files ({ name: sha256 }) are the same files with the same contents */
export function sameFiles(a, b) {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}

/** Whether version a comes after version b, comparing major, minor and patch */
function isNewer(a, b) {
  const parts = (version) => String(version).split('-')[0].split('.').map((n) => Number(n) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/**
 * What install does with a copy that's already there, from the hashes ({ name: sha256 }) of its files
 * as they are (`current`), as this htmlboard ships them (`bundled`) and as the lock has them (`locked`,
 * null when it has no record of them). `lockedBy` is the version that wrote the lock. Without `force`,
 * a copy is kept when it was changed locally ('edited'), when the lock has no record of it, as with what
 * htmlboard 0.10.0 or older installed ('unrecorded'), and when a newer htmlboard wrote it ('newer').
 *
 * @returns {{status: 'unchanged'|'updated'} | {status: 'skipped', reason: 'edited'|'unrecorded'|'newer'}}
 */
export function compareCopy({ current, bundled, locked, lockedBy, force = false }) {
  if (sameFiles(current, bundled)) return { status: 'unchanged' };
  const reason = !locked ? 'unrecorded'
    : !sameFiles(current, locked) ? 'edited'
      : isNewer(lockedBy, VERSION) ? 'newer'
        : null;
  return reason && !force ? { status: 'skipped', reason } : { status: 'updated' };
}
