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
  scanComponents,
  scanDesigns
} from './designs.js';

export {
  installComponents,
  componentPreview,
  COMPONENTS_FOLDER,
  COMPONENTS_SCRIPT
} from './components.js';

export {
  buildCatalog,
  formatCatalog
} from './catalog.js';

export {
  runCheck,
  formatReport
} from './check.js';

export {
  runShot,
  shotPath
} from './shot.js';

export {
  installSkills,
  uninstallSkills,
  SKILLS_DIR,
  SKILL_TARGETS
} from './skills.js';
