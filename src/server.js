import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, 'client');

// Supported MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4'
};

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  '.vscode',
  '.idea',
  '.gemini',
  '.agents'
]);

/**
 * Extract <title> content from HTML text if available
 */
function extractTitleFromHtml(content, fallbackName) {
  const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (match && match[1]?.trim()) {
    return match[1].trim();
  }
  return fallbackName
    .replace(/\.html$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Scan target directory recursively for HTML files to auto-discover
 */
export function discoverDesigns(baseDir) {
  const artboards = [];

  function scan(currentDir, relativePath = '') {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        let title = '';
        let fileContent = '';
        try {
          fileContent = fs.readFileSync(fullPath, 'utf8');
          title = extractTitleFromHtml(fileContent, entry.name);
        } catch {
          title = entry.name;
        }

        const lowerRel = relPath.toLowerCase();
        let category = 'responsive';
        let width = 1200;
        let height = 800;

        if (lowerRel.includes('mobile') || lowerRel.includes('phone') || lowerRel.includes('iphone')) {
          category = 'mobile';
          width = 390;
          height = 844;
        } else if (lowerRel.includes('tablet') || lowerRel.includes('ipad')) {
          category = 'tablet';
          width = 768;
          height = 1024;
        } else if (lowerRel.includes('component') || lowerRel.includes('ui') || lowerRel.includes('atomic')) {
          category = 'components';
          width = 720;
          height = 600;
        } else if (lowerRel.includes('desktop') || lowerRel.includes('laptop') || lowerRel.includes('screen')) {
          category = 'desktop';
          width = 1280;
          height = 800;
        }

        const sectionName = relativePath ? relativePath.replace(/[\\/]/g, ' / ') : 'Root Designs';

        artboards.push({
          id: relPath.replace(/[\\/]/g, '-').replace(/\.html$/i, ''),
          title,
          file: relPath.replace(/\\/g, '/'),
          category,
          width,
          height,
          sectionName,
          tags: [category]
        });
      }
    }
  }

  scan(baseDir);

  // Group into sections
  const sectionsMap = new Map();
  for (const board of artboards) {
    const sName = board.sectionName;
    if (!sectionsMap.has(sName)) {
      sectionsMap.set(sName, {
        id: sName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: sName,
        description: `HTML artboards discovered in ${sName}`,
        artboards: []
      });
    }
    const { sectionName, ...rest } = board;
    sectionsMap.get(sName).artboards.push(rest);
  }

  const projectName = path.basename(path.resolve(baseDir)) || 'Design Explorer';

  return {
    title: projectName,
    description: 'Auto-discovered HTML artboards in workspace',
    autoDiscovered: true,
    sections: Array.from(sectionsMap.values())
  };
}

/**
 * Load designs configuration from designs.json or auto-discover
 */
export function loadDesignsManifest(baseDir) {
  const configPath = path.join(baseDir, 'designs.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const data = JSON.parse(raw);
      return {
        ...data,
        autoDiscovered: false
      };
    } catch (err) {
      console.warn(`[htmlboard] Failed parsing designs.json: ${err.message}. Falling back to auto-discovery.`);
    }
  }
  return discoverDesigns(baseDir);
}

/**
 * Creates and starts the HtmlBoard server
 */
export function createServer(options = {}) {
  const targetDir = path.resolve(options.dir || process.cwd());
  const clients = new Set();

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // API: Designs Manifest
    if (pathname === '/api/designs') {
      const manifest = loadDesignsManifest(targetDir);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(JSON.stringify(manifest, null, 2));
      return;
    }

    // API: SSE Live Reload stream
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
      clients.add(res);

      const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
      }, 25000);

      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }

    // API: Health status
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', dir: targetDir }));
      return;
    }

    // Serve HtmlBoard Explorer client files
    if (pathname === '/' || pathname === '/index.html') {
      serveStaticFile(path.join(CLIENT_DIR, 'index.html'), res);
      return;
    }

    if (pathname.startsWith('/__explorer/')) {
      const clientRelPath = pathname.replace('/__explorer/', '');
      const clientFilePath = path.join(CLIENT_DIR, clientRelPath);
      // Ensure path is within CLIENT_DIR
      if (!clientFilePath.startsWith(CLIENT_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      serveStaticFile(clientFilePath, res);
      return;
    }

    // Serve user artboards and assets from targetDir
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath.startsWith('/')) {
      safePath = safePath.slice(1);
    }

    const filePath = path.join(targetDir, safePath);

    // Security check: must stay within targetDir
    if (!filePath.startsWith(targetDir)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStaticFile(filePath, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`File not found: ${pathname}`);
    }
  });

  function serveStaticFile(filePath, res) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading file');
    }
  }

  // File watcher for live reload with debouncing
  let watchDebounceTimer = null;
  let watcher = null;

  try {
    watcher = fs.watch(targetDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const normalized = filename.replace(/\\/g, '/');

      // Ignore noise
      if (
        normalized.includes('node_modules/') ||
        normalized.includes('.git/') ||
        normalized.includes('.idea/') ||
        normalized.includes('.vscode/') ||
        normalized.endsWith('~') ||
        normalized.endsWith('.tmp')
      ) {
        return;
      }

      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = setTimeout(() => {
        const isManifest = normalized === 'designs.json';
        const isHtml = normalized.endsWith('.html');
        const eventData = JSON.stringify({
          type: isManifest ? 'manifest' : 'file',
          file: normalized,
          isHtml,
          timestamp: Date.now()
        });

        for (const client of clients) {
          client.write(`event: change\ndata: ${eventData}\n\n`);
        }
      }, 100);
    });
  } catch (err) {
    console.warn(`[htmlboard] Live watcher error: ${err.message}`);
  }

  return {
    server,
    targetDir,
    close: () => {
      if (watcher) watcher.close();
      for (const client of clients) {
        client.end();
      }
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

/**
 * Start listening on port with auto-retry if in use
 */
export async function startServer(options = {}) {
  const requestedPort = parseInt(options.port, 10) || 3000;
  const { server, targetDir, close } = createServer(options);

  return new Promise((resolve, reject) => {
    let currentPort = requestedPort;

    function attemptListen(port) {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[htmlboard] Port ${port} is in use, trying ${port + 1}...`);
          currentPort = port + 1;
          attemptListen(currentPort);
        } else {
          reject(err);
        }
      });

      server.listen(port, () => {
        const url = `http://localhost:${port}`;
        resolve({
          server,
          port: currentPort,
          url,
          targetDir,
          close
        });
      });
    }

    attemptListen(requestedPort);
  });
}
