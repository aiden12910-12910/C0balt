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

// 原来是 res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Cache-Control', 'no-store');

  // ========== 1. 分页列视频 ==========
  if (action === 'list') {
    const page = parseInt(req.query.page || '0', 10);
    const size = Math.min(parseInt(req.query.size || '20', 10), 50);

    try {
      const r = await fetch(HF_API, {
        // 列表是 JSON，加短缓存，减少重复请求
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

    // 按 / 分段编码，保留子目录斜杠
    const encodedPath = name.split('/').map(encodeURIComponent).join('/');
    const hfUrl = HF_BASE + encodedPath;

    const headers = { Accept: '*/*' };
    // 透传 Range，支持拖动进度条
    if (req.headers.range) headers.Range = req.headers.range;

    try {
      const hfRes = await fetch(hfUrl, { headers });
      if (!hfRes.ok && hfRes.status !== 206) {
        console.error(`[stream] HF ${hfRes.status} for ${name}`);
        return res.status(hfRes.status).send(`HF ${hfRes.status}`);
      }

      res.status(hfRes.status);
      res.setHeader('Content-Type', hfRes.headers.get('content-type') || 'video/mp4');

      const cr = hfRes.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      const ar = hfRes.headers.get('accept-ranges');
      if (ar) res.setHeader('Accept-Ranges', ar);

      // 不设 Content-Length，避免 Vercel chunked 编码与声明长度不一致
      // 只设 Content-Range，让浏览器按范围判断片段长度
      res.setHeader('Cache-Control', 'public, max-age=3600');

      console.log(`[stream] ${name} status=${hfRes.status} range=${req.headers.range || 'full'} type=${hfRes.headers.get('content-type') || 'unknown'}`);

      if (!hfRes.body) {
        res.end();
        return;
      }

      // 用 Node 流 pipe，正确处理背压和分块
      const nodeStream = Readable.fromWeb(hfRes.body);

      nodeStream.on('error', (err) => {
        console.error(`[stream] pipe error for ${name}:`, err);
        if (!res.writableEnded) res.end();
      });

      res.on('close', () => {
        // 浏览器中途断开时销毁上游流，避免继续拉 HF 数据
        if (!nodeStream.destroyed) nodeStream.destroy();
      });

      nodeStream.pipe(res);
    } catch (e) {
      console.error(`[stream] error for ${name}:`, e);
      if (!res.writableEnded) res.status(500).send('Stream error');
    }
    return;
  }

  return res.status(400).json({ error: 'Unknown action' });
}
