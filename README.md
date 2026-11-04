# C0balt

仿 TikTok「For You」风格的全屏竖滑视频网站。本地用 TikPipe 抓取视频，转成 HLS（m3u8 + ts）上传到 Hugging Face，Vercel 托管的网页用 hls.js 播放。

---

## 架构

```text
本地 (Windows)                              云端
─────────────────                          ─────────────────────────────
TikTok ──Playwright 拦截──▶ yt-dlp 下载
                                  │
                                  ▼
                         X:\TikTok_Downloads
                                  │
                         upload_hf.py：ffmpeg 转 HLS
                         （720p / 30fps / crf 28 / hls_time 2）
                                  │
                                  ▼
                         Hugging Face (hls/{base}/index.m3u8 + seg_*.ts)
                                  │
                                  │  /api/models/...  列 m3u8
                                  │  /resolve/main/... 取 m3u8/ts
                                  ▼
                         Vercel (C0balt 网页)
                         api/fetch-videos.js 代理 m3u8/ts
                         index.html hls.js 播放
