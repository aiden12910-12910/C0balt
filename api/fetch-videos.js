import { Readable } from 'stream';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const HF_USER = 'aiden12910';
const HF_REPOS = [
  'tiktok-videos',
  'tiktok-videos-1',
  'tiktok-videos-2',
  'tiktok-videos-3',
  'tiktok-videos-4',
];
const HF_BASE = (repo) => `https://huggingface.co/${HF_USER}/${repo}/resolve/main/`;

async function listAllFiles() {
  let all = [];
  for (const repo of HF_REPOS) {
    try {
      const r = await fetch(`https://huggingface.co/api/models/${HF_USER}/${repo}`);
      if (!r.ok) continue;
      const data = await r.json();
      const names = (data.siblings || []).map(f => f.rfilename).filter(n => n.endsWith('/index.m3u8'));
      for (const n of names) all.push({ name: n, repo });
    } catch (e) {
      console.error(`[list] ${repo} failed:`, e.message);
    }
  }
  return all;
}

export default async function handler(req, res) {
  const action = req.query.action || 'list';
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (action === 'list') {
    const page = parseInt(req.query.page || '0', 10);
    const size = Math.min(parseInt(req.query.size || '20', 10), 50);
    const repoFilter = req.query.repo || 'all';
    try {
      let all = await listAllFiles();
      if (repoFilter !== 'all') {
        all = all.filter(x => x.repo === repoFilter);
      }
      all.sort((a, b) => a.name.localeCompare(b.name));
      const start = page * size;
      const slice = all.slice(start, start + size);
      const hasMore = start + size < all.length;
      const videos = slice.map(x => ({
        name: x.name,
        repo: x.repo,
        url: `/api/fetch-videos?action=stream&repo=${encodeURIComponent(x.repo)}&name=${encodeURIComponent(x.name)}`,
      }));
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
      return res.status(200).json({ page, size, total: all.length, hasMore, videos });
    } catch (e) {
      console.error('[list] error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'stream') {
    const name = decodeURIComponent(req.query.name || '');
    if (!name) return res.status(400).send('Missing name');
    const repo = req.query.repo || HF_REPOS[0];
    const encodedPath = name.split('/').map(encodeURIComponent).join('/');
    const hfUrl = HF_BASE(repo) + encodedPath;
    const headers = { Accept: '*/*' };
    if (req.headers.range) headers.Range = req.headers.range;
    try {
      const hfRes = await fetch(hfUrl, { headers });
      if (!hfRes.ok && hfRes.status !== 206) {
        console.error(`[stream] HF ${hfRes.status} for ${repo}/${name}`);
        return res.status(hfRes.status).send(`HF ${hfRes.status}`);
      }

      if (name.endsWith('.m3u8')) {
        const text = await hfRes.text();
        const baseDir = name.substring(0, name.lastIndexOf('/') + 1);
        const rewritten = text.split('\n').map(line => {
          const t = line.trim();
          if (!t || t.startsWith('#')) return line;
          return `/api/fetch-videos?action=stream&repo=${encodeURIComponent(repo)}&name=${encodeURIComponent(baseDir + t)}`;
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(rewritten);
      }

      res.status(hfRes.status);
      res.setHeader('Content-Type', 'video/mp2t');
      const cr = hfRes.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      const cl = hfRes.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);
      res.setHeader('Cache-Control', 'no-store');
      if (!hfRes.body) { res.end(); return; }
      const nodeStream = Readable.fromWeb(hfRes.body);
      nodeStream.on('error', (err) => { console.error('[stream] pipe error:', err); if (!res.writableEnded) res.end(); });
      res.on('close', () => { if (!nodeStream.destroyed) nodeStream.destroy(); });
      nodeStream.pipe(res);
    } catch (e) {
      console.error(`[stream] error for ${name}:`, e);
      if (!res.writableEnded) res.status(500).send('Stream error');
    }
    return;
  }

  return res.status(400).json({ error: 'Unknown action' });
}
