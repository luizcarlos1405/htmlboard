import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

/** Agent skills bundled with the package, one folder per skill */
export const SKILLS_DIR = path.join(__dirname, '..', 'skills');

/**
 * Where each agent looks for skills, relative to the project root (or the home folder with `global`).
 * `agents` is the shared Agent Skills location read by Codex and other agents.
 */
export const SKILL_TARGETS = {
  claude: path.join('.claude', 'skills'),
  agents: path.join('.agents', 'skills')
};

/**
 * The file install leaves beside each SKILL.md: the version that wrote the skill and a hash of what it
 * wrote. A copy that still has that hash is out of date at most, so the next install updates it; one
 * that doesn't was edited, and is kept.
 */
export const SKILL_RECORD = '.htmlboard-install.json';

function bundledSkills() {
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function resolveTargets(agent = 'all') {
  if (agent === 'all') return Object.keys(SKILL_TARGETS);
  if (!SKILL_TARGETS[agent]) {
    throw new Error(`Unknown agent "${agent}". Use one of: ${[...Object.keys(SKILL_TARGETS), 'all'].join(', ')}`);
  }
  return [agent];
}

/** List every file under dir as paths relative to it, with / on every system */
function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

/**
 * A hash of a skill folder's files, names and contents, leaving out the record. Line endings don't
 * count: a checkout that turns them into CRLF (Git on Windows) hasn't edited the skill.
 */
function skillHash(dir) {
  const hash = crypto.createHash('sha256');
  for (const file of listFiles(dir).filter((file) => file !== SKILL_RECORD).sort()) {
    const content = fs.readFileSync(path.join(dir, file), 'latin1').replaceAll('\r\n', '\n');
    hash.update(`${file}\0${crypto.createHash('sha256').update(content, 'latin1').digest('hex')}\n`);
  }
  return hash.digest('hex');
}

function readRecord(dir) {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dir, SKILL_RECORD), 'utf8'));
    return typeof record?.sha256 === 'string' ? record : null;
  } catch {
    return null;
  }
}

function writeRecord(dir, sha256) {
  fs.writeFileSync(path.join(dir, SKILL_RECORD), `${JSON.stringify({ htmlboard: VERSION, sha256 }, null, 2)}\n`);
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
 * Copy the bundled skills into the agents' skill folders.
 * A copy nobody changed since install wrote it is updated. Without `force`, a copy is kept when it was
 * changed locally ('edited'), when it has no record of what was installed, as with skills installed by
 * htmlboard 0.10.0 or older ('unrecorded'), and when a newer htmlboard installed it ('newer').
 *
 * @param {object} [options]
 * @param {'claude'|'agents'|'all'} [options.agent='all']
 * @param {boolean} [options.global=false] Install under the home folder instead of the project
 * @param {string} [options.dir=process.cwd()] Project root (ignored with `global`)
 * @param {boolean} [options.force=false] Replace the skills it would keep
 * @returns {{skill: string, path: string, status: 'installed'|'updated'|'unchanged'|'skipped',
 *   reason?: 'edited'|'unrecorded'|'newer'}[]} A skipped skill says why in `reason`
 */
export function installSkills({ agent = 'all', global = false, dir = process.cwd(), force = false } = {}) {
  const base = global ? os.homedir() : path.resolve(dir);
  const results = [];

  for (const target of resolveTargets(agent)) {
    for (const skill of bundledSkills()) {
      const src = path.join(SKILLS_DIR, skill);
      const dest = path.join(base, SKILL_TARGETS[target], skill);
      const bundled = skillHash(src);
      let status = 'installed';

      if (fs.existsSync(dest)) {
        const copy = skillHash(dest);
        const record = readRecord(dest);
        if (copy === bundled) {
          // Recorded now if it wasn't (installed by an older htmlboard), so the next upgrade can update it
          if (record?.sha256 !== bundled) writeRecord(dest, bundled);
          results.push({ skill, path: dest, status: 'unchanged' });
          continue;
        }
        const reason = !record ? 'unrecorded'
          : record.sha256 !== copy ? 'edited'
            : isNewer(record.htmlboard, VERSION) ? 'newer'
              : null;
        if (reason && !force) {
          results.push({ skill, path: dest, status: 'skipped', reason });
          continue;
        }
        status = 'updated';
      }

      // A skill folder that is a symlink stays one: the folder it points to is replaced
      const folder = fs.existsSync(dest) ? fs.realpathSync(dest) : dest;
      fs.rmSync(folder, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(folder), { recursive: true });
      fs.cpSync(src, folder, { recursive: true });
      writeRecord(folder, bundled);
      results.push({ skill, path: dest, status });
    }
  }

  return results;
}

/**
 * Remove the bundled skills from the agents' skill folders.
 * Takes the same options as installSkills (except `force`).
 * @returns {{skill: string, path: string, status: 'removed'|'absent'}[]}
 */
export function uninstallSkills({ agent = 'all', global = false, dir = process.cwd() } = {}) {
  const base = global ? os.homedir() : path.resolve(dir);
  const results = [];

  for (const target of resolveTargets(agent)) {
    for (const skill of bundledSkills()) {
      const dest = path.join(base, SKILL_TARGETS[target], skill);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
        results.push({ skill, path: dest, status: 'removed' });
      } else {
        results.push({ skill, path: dest, status: 'absent' });
      }
    }
  }

  return results;
}
