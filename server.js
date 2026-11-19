// 로컬 실행용: public 화면 + /api/* 함수를 한 번에 띄운다
//   node --env-file=.env server.js   (또는 npm start)
// Vercel 에 올리면 이 파일 대신 Vercel 이 api/*.js 를 직접 부른다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function shim(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  return res;
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) break; }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  shim(res);
  try {
    const api = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (api) {
      const mod = await import(`./api/${api[1]}.js`).catch(() => null);
      if (!mod) return res.status(404).json({ error: '없는 API' });
      req.body = await readBody(req);
      return await mod.default(req, res);
    }
    const path = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(PUBLIC)) return res.status(403).end();
    const data = await readFile(path);
    res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).end('없는 파일');
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: '서버 오류' });
  }
}).listen(PORT, () => console.log(`길잡이 실행 중: http://localhost:${PORT}`));
