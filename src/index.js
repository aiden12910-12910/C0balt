const HF_USER = 'aiden12910';
const HF_REPOS = [
  'tiktok-videos',
  'tiktok-videos-1',
  'tiktok-videos-2',
  'tiktok-videos-3',
  'tiktok-videos-4',
];
const HF_BASE = (repo) => `https://huggingface.co/${HF_USER}/${repo}/resolve/main/`;

const KV_KEY = 'video_list_v1';
const KV_TTL_SECONDS = 300;

async function listAllFiles(env) {
  if (env.VIDEO_KV) {
    try {
      const cached = await env.VIDEO_KV.get(KV_KEY, 'json');
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('[list] KV hit,', cached.length, 'items');
        return cached;
      }
    } catch (e) {
      console.error('[list] KV read failed:', e.message);
    }
  }

  console.log('[list] KV miss, fetching HF');
  let all = [];
  for (const repo of HF_REPOS) {
    try {
      const r = await fetch(`https://huggingface.co/api/models/${HF_USER}/${repo}`);
      if (!r.ok) continue;
      const data = await r.json();
      const names = (data.siblings || [])
        .map(f => f.rfilename)
        .filter(n => n.endsWith('/index.m3u8'));
      for (const n of names) all.push({ name: n, repo });
    } catch (e) {
      console.error(`[list] ${repo} failed:`, e.message);
    }
  }

  if (env.VIDEO_KV && all.length > 0) {
    try {
      await env.VIDEO_KV.put(KV_KEY, JSON.stringify(all), { expirationTtl: KV_TTL_SECONDS });
      console.log('[list] KV written,', all.length, 'items');
    } catch (e) {
      console.error('[list] KV write failed:', e.message);
    }
  }

  return all;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    }

    const action = url.searchParams.get('action') || 'list';
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

    if (action === 'list') {
      const page = parseInt(url.searchParams.get('page') || '0', 10);
      const size = Math.min(parseInt(url.searchParams.get('size') || '20', 10), 50);
      const repoFilter = url.searchParams.get('repo') || 'all';
      try {
        let all = await listAllFiles(env);
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
        return new Response(JSON.stringify({ page, size, total: all.length, hasMore, videos }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=30, s-maxage=30',
          },
        });
      } catch (e) {
        console.error('[list] error:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'stream') {
      const name = decodeURIComponent(url.searchParams.get('name') || '');
      if (!name) {
        return new Response('Missing name', { status: 400, headers: corsHeaders });
      }
      const repo = url.searchParams.get('repo') || HF_REPOS[0];
      const encodedPath = name.split('/').map(encodeURIComponent).join('/');
      const hfUrl = HF_BASE(repo) + encodedPath;

      const headers = { Accept: '*/*' };
      const range = request.headers.get('Range');
      if (range) headers.Range = range;

      try {
        const hfRes = await fetch(hfUrl, { headers });
        if (!hfRes.ok && hfRes.status !== 206) {
          console.error(`[stream] HF ${hfRes.status} for ${repo}/${name}`);
          return new Response(`HF ${hfRes.status}`, { status: hfRes.status, headers: corsHeaders });
        }

        if (name.endsWith('.m3u8')) {
          const text = await hfRes.text();
          const baseDir = name.substring(0, name.lastIndexOf('/') + 1);
          const rewritten = text.split('\n').map(line => {
            const t = line.trim();
            if (!t || t.startsWith('#')) return line;
            return `/api/fetch-videos?action=stream&repo=${encodeURIComponent(repo)}&name=${encodeURIComponent(baseDir + t)}`;
          }).join('\n');
          return new Response(rewritten, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Cache-Control': 'no-store',
            },
          });
        }

        const outHeaders = new Headers(corsHeaders);
        outHeaders.set('Content-Type', 'video/mp2t');
        const cr = hfRes.headers.get('content-range');
        if (cr) outHeaders.set('Content-Range', cr);
        const cl = hfRes.headers.get('content-length');
        if (cl) outHeaders.set('Content-Length', cl);
        outHeaders.set('Cache-Control', 'no-store');

        return new Response(hfRes.body, {
          status: hfRes.status,
          headers: outHeaders,
        });
      } catch (e) {
        console.error(`[stream] error for ${name}:`, e);
        return new Response('Stream error', { status: 500, headers: corsHeaders });
      }
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
