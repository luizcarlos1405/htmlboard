import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_FILE, hashFile, readLock, writeLock, sameFiles, compareCopy } from './lock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

/** Each file of a skill folder but its lock, by its path in the folder, with its hash */
function skillFiles(dir) {
  return Object.fromEntries(listFiles(dir)
    .filter((file) => file !== LOCK_FILE)
    .map((file) => [file, hashFile(path.join(dir, file))]));
}

/**
 * Copy the bundled skills into the agents' skill folders, each with a .htmlboard-lock.json of its
 * files. A copy nobody changed since install wrote it is updated. Without `force`, a copy is kept when
 * it was changed locally ('edited'), when it has no lock, as with skills installed by htmlboard 0.10.0
 * or older ('unrecorded'), and when a newer htmlboard installed it ('newer').
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
      const bundled = skillFiles(src);
      let status = 'installed';

      if (fs.existsSync(dest)) {
        const lock = readLock(dest);
        const result = compareCopy({ current: skillFiles(dest), bundled, locked: lock?.files ?? null, lockedBy: lock?.htmlboard, force });
        if (result.status !== 'updated') {
          // Locked now if it wasn't (installed by an older htmlboard), so the next upgrade can update it
          if (result.status === 'unchanged' && !(lock && sameFiles(lock.files, bundled))) writeLock(dest, bundled);
          results.push({ skill, path: dest, ...result });
          continue;
        }
        status = 'updated';
      }

      // A skill folder that is a symlink stays one: the folder it points to is replaced
      const folder = fs.existsSync(dest) ? fs.realpathSync(dest) : dest;
      fs.rmSync(folder, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(folder), { recursive: true });
      fs.cpSync(src, folder, { recursive: true });
      writeLock(folder, bundled);
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
