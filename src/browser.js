import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// A browser for the canvas to run in out of sight (headless), so `htmlboard check` and `shot` work
// with no canvas open in one: an installed Chrome, Chromium or Edge, else Firefox. HTMLBOARD_BROWSER
// names another (a path or a command) or, set to "none", turns this off. Nothing is downloaded: the
// browser only opens the canvas's page, which does the work as it does in any browser.

const FAMILIES = [
  {
    name: 'Google Chrome',
    engine: 'chromium',
    commands: ['google-chrome', 'google-chrome-stable', 'chrome'],
    mac: ['Google Chrome.app/Contents/MacOS/Google Chrome'],
    windows: ['Google\\Chrome\\Application\\chrome.exe'],
  },
  {
    name: 'Chromium',
    engine: 'chromium',
    commands: ['chromium', 'chromium-browser'],
    mac: ['Chromium.app/Contents/MacOS/Chromium'],
    windows: ['Chromium\\Application\\chrome.exe'],
  },
  {
    name: 'Microsoft Edge',
    engine: 'chromium',
    commands: ['microsoft-edge', 'microsoft-edge-stable', 'msedge'],
    mac: ['Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    windows: ['Microsoft\\Edge\\Application\\msedge.exe'],
  },
  {
    name: 'Firefox',
    engine: 'firefox',
    commands: ['firefox', 'firefox-esr'],
    mac: ['Firefox.app/Contents/MacOS/firefox'],
    windows: ['Mozilla Firefox\\firefox.exe'],
  },
];

/** How long a browser has to quit when asked, before it's made to */
const QUIT_MS = 5000;
/** How long Chromium's other processes go on writing in its profile after it quits */
const AFTER_QUIT_MS = 100;
/** Profiles in the temporary folder: htmlboard-browser-…, with the id of the process that opened it */
const PROFILE_PREFIX = 'htmlboard-browser-';
const OWNER_FILE = 'htmlboard-owner';
/** A profile without its owner file (removed, then written in again by a browser quitting) this old is left over */
const LEFT_MS = 10 * 60 * 1000;

function isExecutable(file, platform) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** A command as found on the PATH: its full path, or null */
function onPath(command, env, platform) {
  const exts = platform === 'win32' ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)] : [''];
  for (const dir of (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, command + ext);
      if (isExecutable(file, platform)) return file;
    }
  }
  return null;
}

/** Where browsers install themselves, outside the PATH */
function installed(family, env, platform) {
  if (platform === 'darwin') {
    return family.mac.flatMap((app) => ['/Applications', path.join(os.homedir(), 'Applications')].map((dir) => path.join(dir, app)));
  }
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return family.windows.flatMap((exe) => roots.map((root) => `${root}\\${exe}`));
  }
  return [];
}

/**
 * The browser to run the canvas in out of sight: `{ path, name, engine }` (engine: chromium or
 * firefox), or null when there's none, or HTMLBOARD_BROWSER says "none" or names one that isn't there.
 */
export function findBrowser({ env = process.env, platform = process.platform } = {}) {
  const named = env.HTMLBOARD_BROWSER?.trim();
  if (named) {
    if (/^(none|off|false|0)$/i.test(named)) return null;
    const file = /[\\/]/.test(named) ? (isExecutable(named, platform) ? path.resolve(named) : null) : onPath(named, env, platform);
    if (!file) return null;
    const family = FAMILIES.find((f) => f.commands.includes(path.basename(file).toLowerCase().replace(/\.exe$/, '')));
    return { path: file, name: family?.name ?? path.basename(file), engine: family?.engine ?? (/firefox/i.test(file) ? 'firefox' : 'chromium') };
  }
  for (const family of FAMILIES) {
    for (const command of family.commands) {
      const file = onPath(command, env, platform);
      if (file) return { path: file, name: family.name, engine: family.engine };
    }
    const file = installed(family, env, platform).find((candidate) => isExecutable(candidate, platform));
    if (file) return { path: file, name: family.name, engine: family.engine };
  }
  return null;
}

// Firefox in a new profile would check whether it's the default browser, show its welcome pages
// and send reports; none of that is wanted out of sight.
const FIREFOX_PREFS = [
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("browser.startup.homepage_override.mstone", "ignore");',
  'user_pref("browser.aboutwelcome.enabled", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
  'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
  'user_pref("app.update.auto", false);',
].join('\n');

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // someone else's
  }
};

/**
 * Removes the profiles left in the temporary folder by browsers whose htmlboard is gone (stopped
 * while its browser ran, before it could remove it), and by browsers that wrote in theirs again as
 * they quit. Others' profiles, and the ones in use, stay.
 */
export function removeLeftProfiles() {
  let names = [];
  try {
    names = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(PROFILE_PREFIX));
  } catch {
    return;
  }
  for (const name of names) {
    const dir = path.join(os.tmpdir(), name);
    try {
      let owner = null;
      try {
        owner = Number(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8'));
      } catch {
        // No owner: removed once, and written in again
      }
      const left = owner ? !isAlive(owner) : Date.now() - fs.statSync(dir).mtimeMs > LEFT_MS;
      if (left) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Someone else's, or gone meanwhile
    }
  }
}

/**
 * Opens `url` in the browser, out of sight, with a profile of its own (a temporary folder, so it
 * shares nothing with the person's browser). Returns `exited` (a promise of its end, with how it
 * ended) and `close()`, which quits it and removes its profile. It quits with this process too:
 * Chromium even when this process is killed outright, as it quits once its pipe from it closes.
 */
export function launchBrowser(browser, url) {
  removeLeftProfiles();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  fs.writeFileSync(path.join(profile, OWNER_FILE), String(process.pid));
  let args;
  let stdio = 'ignore';
  if (browser.engine === 'firefox') {
    fs.writeFileSync(path.join(profile, 'user.js'), `${FIREFOX_PREFS}\n`);
    args = ['--headless', '--no-remote', '--profile', profile, url];
  } else {
    args = ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--disable-extensions', '--mute-audio', '--remote-debugging-pipe',
      // As root (a container, CI), Chromium won't start in its sandbox
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      url];
    stdio = ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']; // the pipe: nothing is sent on it
  }
  const child = spawn(browser.path, args, { stdio });
  child.stdio[4]?.resume(); // what it might say there, read and dropped
  child.stdio[3]?.on('error', () => {}); // a pipe it closed as it quit
  child.stdio[4]?.on('error', () => {});
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ error }));
  });
  const kill = () => {
    try {
      child.kill();
    } catch {
      // gone already
    }
  };
  process.on('exit', kill);
  let closing = null;
  return {
    exited,
    close() {
      closing ||= (async () => {
        process.off('exit', kill);
        const running = () => child.exitCode === null && child.signalCode === null && child.pid !== undefined;
        // Whether it quit within ms (the timer goes once it has: left running, it would keep this process up)
        const quits = (ms) => new Promise((resolve) => {
          const timer = setTimeout(resolve, ms, false);
          exited.then(() => {
            clearTimeout(timer);
            resolve(true);
          });
        });
        if (running()) {
          kill();
          if (!await quits(QUIT_MS) && running()) {
            child.kill('SIGKILL');
            await quits(QUIT_MS);
          }
          await new Promise((resolve) => setTimeout(resolve, AFTER_QUIT_MS));
        }
        try {
          fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
          // Still in use: removed when the next browser opens (removeLeftProfiles)
        }
      })();
      return closing;
    },
  };
}
