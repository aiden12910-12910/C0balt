// api/fetch-videos.js
export const config = {
  runtime: 'nodejs',
  maxDuration: 60, // Hobby 计划最长 60 秒（Pro 可 300 秒），流式代理够用
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
    const size = Math.min(parseInt(req.query.size || '20', 10), 50); // 单页最多 50，预留网络损耗

    try {
      const r = await fetch(HF_API);
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
        // 走代理流，前端不用直连 HF
        url: `/api/fetch-videos?action=stream&name=${encodeURIComponent(name)}`,
      }));

      console.log(`[list] page=${page} size=${size} returned=${videos.length} total=${all.length} hasMore=${hasMore}`);

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

    const hfUrl = HF_BASE + encodeURIComponent(name);
    const headers = { Accept: '*/*' };
    if (req.headers.range) headers.Range = req.headers.range;

    try {
      const hfRes = await fetch(hfUrl, { headers });
      if (!hfRes.ok && hfRes.status !== 206) {
        console.error(`[stream] HF ${hfRes.status} for ${name}`);
        return res.status(hfRes.status).send(`HF ${hfRes.status}`);
      }

      res.setHeader('Content-Type', hfRes.headers.get('content-type') || 'video/mp4');
      const cr = hfRes.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      const ar = hfRes.headers.get('accept-ranges');
      if (ar) res.setHeader('Accept-Ranges', ar);
      const cl = hfRes.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);
      res.setHeader('Cache-Control', 'public, max-age=3600');

      console.log(`[stream] ${name} status=${hfRes.status} range=${req.headers.range || 'full'}`);

      const reader = hfRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (e) {
      console.error(`[stream] error for ${name}:`, e);
      res.status(500).send('Stream error');
    }
    return;
  }

  return res.status(400).json({ error: 'Unknown action' });
}
