// api/fetch-videos.js
import { Readable } from 'stream';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const HF_USER = 'aiden12910';
const HF_REPO = 'tiktok-videos';
const HF_API = `https://huggingface.co/api/models/${HF_USER}/${HF_REPO}`;
const HF_BASE = `https://huggingface.co/${HF_USER}/${HF_REPO}/resolve/main/`;

export default async function handler(req, res) {
  const action = req.query.action || 'list';

  res.setHeader('Access-Control-Allow-Origin', '*');

  // ========== 1. 分页列视频 ==========
  if (action === 'list') {
    const page = parseInt(req.query.page || '0', 10);
    const size = Math.min(parseInt(req.query.size || '20', 10), 50);

    try {
      const r = await fetch(HF_API, {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        console.error('[list] HF API failed:', r.status);
        return res.status(500).json({ error: 'HF API failed', status: r.status });
      }
      const data = await r.json();
      const all = (data.siblings || [])
        .map(f => f.rfilename)
        .filter(n => n.toLowerCase().endsWith('.mp4'))
        .sort();

      const start = page * size;
      const slice = all.slice(start, start + size);
      const hasMore = start + size < all.length;

      const videos = slice.map(name => ({
        name,
        url: `/api/fetch-videos?action=stream&name=${encodeURIComponent(name)}`,
      }));

      console.log(`[list] page=${page} size=${size} returned=${videos.length} total=${all.length} hasMore=${hasMore}`);

      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
      return res.status(200).json({
        page,
        size,
        total: all.length,
        hasMore,
        videos,
      });
    } catch (e) {
      console.error('[list] error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ========== 2. 流式代理视频 ==========
if (action === 'stream') {
  const name = req.query.name;
  if (!name) return res.status(400).send('Missing name');

  // 前端带 full=1 时，强制完整 GET，不透传 Range
  const forceFull = req.query.full === '1';

  const encodedPath = name.split('/').map(encodeURIComponent).join('/');
  const hfUrl = HF_BASE + encodedPath;

  const headers = { Accept: '*/*' };
  if (!forceFull && req.headers.range) headers.Range = req.headers.range;

  try {
    const hfRes = await fetch(hfUrl, { headers });
    if (!hfRes.ok && hfRes.status !== 206) {
      return res.status(hfRes.status).send(`HF ${hfRes.status}`);
    }

    res.status(hfRes.status);
    res.setHeader('Content-Type', hfRes.headers.get('content-type') || 'video/mp4');

    const cr = hfRes.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    const ar = hfRes.headers.get('accept-ranges');
    if (ar) res.setHeader('Accept-Ranges', ar);
    const cl = hfRes.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);

    res.setHeader('Cache-Control', 'no-store');

    console.log(`[stream] ${name} full=${forceFull} status=${hfRes.status} range=${headers.Range || 'full'} len=${cl || 'none'}`);

    if (!hfRes.body) { res.end(); return; }

    const nodeStream = Readable.fromWeb(hfRes.body);
    nodeStream.on('error', (err) => {
      if (!res.writableEnded) res.end();
    });
    res.on('close', () => {
      if (!nodeStream.destroyed) nodeStream.destroy();
    });
    nodeStream.pipe(res);
  } catch (e) {
    if (!res.writableEnded) res.status(500).send('Stream error');
  }
  return;
}
  }

  return res.status(400).json({ error: 'Unknown action' });
}
