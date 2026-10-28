/**
 * HtmlBoard
 * Infinite canvas and design explorer for HTML artboards — designed for humans and LLMs
 */

export {
  createServer,
  startServer,
  watchTree
} from './server.js';

export {
  discoverDesigns,
  loadDesignsManifest,
  normalizeManifest,
  inferCategory,
  parseDesignMeta,
  scanDesigns
} from './designs.js';

export {
  installSkills,
  uninstallSkills,
  SKILLS_DIR,
  SKILL_TARGETS
} from './skills.js';
