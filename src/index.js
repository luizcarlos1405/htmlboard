/**
 * HtmlBoard
 * Infinite canvas and design explorer for HTML artboards — designed for humans and LLMs
 */

export {
  createServer,
  startServer,
  discoverDesigns,
  loadDesignsManifest,
  normalizeManifest,
  inferCategory
} from './server.js';

export {
  installSkills,
  uninstallSkills,
  SKILLS_DIR,
  SKILL_TARGETS
} from './skills.js';
