const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const root = __dirname;
const htmlPath = path.join(root, 'Tracker.html');
const dataPath = path.join(root, 'tracker-data.json');
const port = Number(process.env.PORT || 8765);
const host = '127.0.0.1';

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

function readBackup() {
  if (!fs.existsSync(dataPath)) {
    return {
      exportedAt: null,
      app: 'The Tracker',
      version: 3,
      state: {
        phase: 1,
        days: {},
        metrics: { cfRating: [], zetamacPeak: [] },
        customBenchmarks: [],
        errorLog: [],
        startDate: localDateKey()
      }
    };
  }
  try {
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    return {
      exportedAt: null,
      app: 'The Tracker',
      version: 3,
      loadError: `Could not parse ${path.basename(dataPath)}: ${err.message}`,
      state: {
        phase: 1,
        days: {},
        metrics: { cfRating: [], zetamacPeak: [] },
        customBenchmarks: [],
        errorLog: [],
        startDate: localDateKey()
      }
    };
  }
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/Tracker.html')) {
      send(res, 200, fs.readFileSync(htmlPath), 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/load') {
      send(res, 200, JSON.stringify(readBackup()), 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const body = await collectBody(req);
      const parsed = JSON.parse(body);
      parsed.savedAt = new Date().toISOString();
      const tmpPath = `${dataPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2));
      fs.renameSync(tmpPath, dataPath);
      send(res, 200, JSON.stringify({ ok: true, savedAt: parsed.savedAt }), 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/motivation_quotes.json') {
      const qPath = path.join(root, 'motivation_quotes.json');
      send(res, 200, fs.readFileSync(qPath), 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/tracker-data.json') {
      send(res, 200, JSON.stringify(readBackup(), null, 2), 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const assetPath = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
      if (!assetPath.startsWith(path.normalize(path.join(root, 'assets')) + path.sep)) {
        send(res, 403, 'Forbidden');
        return;
      }
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        send(res, 200, fs.readFileSync(assetPath), contentTypeFor(assetPath));
        return;
      }
    }

    send(res, 404, 'Not found');
  } catch (err) {
    send(res, 500, err.stack || err.message);
  }
});

server.listen(port, host, () => {
  const url = `http://localhost:${port}`;
  console.log(`Tracker running at ${url}`);
  console.log(`Autosave file: ${dataPath}`);

  // Automatically open browser
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${start} ${url}`);
});
