# C0balt - Cobalt

A TikTok "For You" style video feed website. Videos are downloaded locally with TikPipe, uploaded to Hugging Face, and played on a Vercel-deployed website.

一个仿 TikTok「For You」风格的全屏竖滑视频网站。视频由 TikPipe 在本地抓取，上传到 Hugging Face，然后在 Vercel 部署的网页上播放。

---

## Architecture / 架构

```text
Local PC (TikPipe)                         Cloud
─────────────────                          ─────────────────────────────
X:\TikTok_Downloads  ──upload_hf.py──▶  Hugging Face (video storage)
                                                │
                                                │  HTTPS /resolve/ links
                                                ▼
                                     Vercel (C0balt website)
                                     fetches HF API → renders <video>
```

- **TikPipe** downloads videos from your TikTok feed to a local folder.
- **upload_hf.py** uploads the MP4 files to a Hugging Face model repo, then deletes the local copies.
- **C0balt website** (hosted on Vercel) calls the Hugging Face API to list all `.mp4` files in the repo and renders them as a full-screen vertical feed.

- **TikPipe** 从你的 TikTok 推荐流抓取视频到本地文件夹。
- **upload_hf.py** 把 MP4 文件上传到 Hugging Face 的 model 仓库，然后删除本地副本。
- **C0balt 网页**（部署在 Vercel）调用 Hugging Face API 列出仓库里所有 `.mp4` 文件，渲染成全屏竖滑视频流。

---

## How it works / 实现原理

### 1. Download / 抓取

TikPipe launches a real Chrome browser with your saved TikTok session, navigates to `tiktok.com/foryou`, scrolls the feed, and intercepts the JSON API responses (`/api/recommend/item_list/`). Each intercepted video is immediately queued to `yt-dlp` for download.

TikPipe 启动一个带登录状态的真实 Chrome 浏览器，打开 `tiktok.com/foryou`，自动滚动，拦截 JSON API 响应（`/api/recommend/item_list/`）。每个拦截到的视频立即交给 `yt-dlp` 下载。

> **Why intercept instead of DOM scraping?** TikTok uses DOM virtualization (elements are unmounted when off-screen), so DOM scraping is unreliable. Network interception gets 100% of the video IDs with no misses.
>
> **为什么拦截网络而不是爬 DOM？** TikTok 使用 DOM 虚拟化（离开视口的元素会被销毁），所以 DOM 爬取不可靠。网络拦截能 100% 拿到视频 ID，不会漏。

### 2. Upload / 上传

`upload_hf.py` reads the HF token from the environment variable `HF_TOKEN`, scans the download folder for `.mp4` files, uploads each one to the Hugging Face repo, and deletes the local file after a successful upload.

`upload_hf.py` 从环境变量 `HF_TOKEN` 读取 Token，扫描下载文件夹里的 `.mp4` 文件，逐个上传到 Hugging Face 仓库，上传成功后删除本地文件。

> **Why Hugging Face?** It offers free public storage (best-effort, no hard limit) and the `/resolve/main/` endpoint returns files with CORS headers, so `<video>` tags can load them directly from a Vercel-hosted page.
>
> **为什么用 Hugging Face？** 它提供免费的公开存储（尽力而为，无硬性上限），且 `/resolve/main/` 端点返回文件时带 CORS 头，Vercel 网页里的 `<video>` 标签能直接加载。

### 3. Playback / 播放

The C0balt website does three things:

1. Calls `https://huggingface.co/api/models/{user}/{repo}` to get the file list.
2. Filters for `.mp4` files.
3. Renders each one as a full-screen slide with `scroll-snap`, auto-playing the visible one and pausing the rest.

C0balt 网页做三件事：

1. 调用 `https://huggingface.co/api/models/{user}/{repo}` 获取文件列表。
2. 过滤出 `.mp4` 文件。
3. 把每个视频渲染成全屏 slide，用 `scroll-snap` 实现一屏一个，可见的自动播放，其余暂停。

---

## Setup / 配置

### Prerequisites / 前置要求

- Windows 10/11 (64-bit) / Windows 10/11（64 位）
- Python 3.10+ / Python 3.10 以上
- Google Chrome / Google Chrome 浏览器
- A Hugging Face account / 一个 Hugging Face 账号

### Step 1 — Install dependencies / 安装依赖

Double-click `update.bat`, or run:

双击 `update.bat`，或运行：

```cmd
python -m pip install -U -r requirements.txt
playwright install chromium
```

### Step 2 — Set the HF token / 设置 HF Token

1. Go to https://huggingface.co/settings/tokens and create a token with **Write** permission.
2. Run once in PowerShell (permanent):
   ```powershell
   setx HF_TOKEN "hf_your_token_here"
   ```
3. Close and reopen PowerShell. Verify:
   ```powershell
   echo $env:HF_TOKEN
   ```

1. 打开 https://huggingface.co/settings/tokens，创建一个 **Write** 权限的 Token。
2. 在 PowerShell 里跑一次（永久生效）：
   ```powershell
   setx HF_TOKEN "hf_你的Token"
   ```
3. 关掉 PowerShell 重新打开，验证：
   ```powershell
   echo $env:HF_TOKEN
   ```

### Step 3 — Create the HF repo / 创建 HF 仓库

Create a **Model** repo on Hugging Face (e.g. `yourname/tiktok-videos`) and make it **Public**.

在 Hugging Face 上创建一个 **Model** 仓库（比如 `yourname/tiktok-videos`），设为 **Public**。

### Step 4 — Configure `config.json` / 配置 `config.json`

```json
{
    "ruta_descargas": "X:\\TikTok_Downloads",
    "cantidad_videos": 30,
    "descargas_simultaneas": 6
}
```

| Key | Meaning |
|---|---|
| `ruta_descargas` | Download folder / 下载目录 |
| `cantidad_videos` | Target number of videos per run / 每次抓取目标数量 |
| `descargas_simultaneas` | Concurrent downloads (4–8 recommended) / 并发下载数（建议 4–8） |

### Step 5 — Login once / 首次登录

Double-click `login.bat` (or run `python login.py`). A Chrome window opens. Log in to TikTok, then **close the window**. The session is saved to `perfil_navegador/`.

双击 `login.bat`（或运行 `python login.py`）。弹出 Chrome，登录 TikTok，然后**关掉窗口**。登录状态保存到 `perfil_navegador/`。

### Step 6 — Run / 运行

Double-click `run.bat`. It will:

1. Check that `HF_TOKEN` is set.
2. Run `main.py` to download videos.
3. Run `upload_hf.py` to upload to HF and delete local files.

双击 `run.bat`，它会：

1. 检查 `HF_TOKEN` 是否设置。
2. 跑 `main.py` 下载视频。
3. 跑 `upload_hf.py` 上传 HF 并删除本地文件。

---

## Website deployment / 网站部署

### Step 1 — Push the website to GitHub / 把网页推到 GitHub

Create a new GitHub repo named `C0balt` and add `index.html`. The website is a single file, no build step required.

在 GitHub 新建仓库 `C0balt`，加一个 `index.html`。网页只有一个文件，不需要构建。

### Step 2 — Deploy on Vercel / Vercel 部署

1. Go to https://vercel.com/new and import the `C0balt` repo.
2. **Framework Preset** → **Other**.
3. Click **Deploy**.

1. 打开 https://vercel.com/new，导入 `C0balt` 仓库。
2. **Framework Preset** 选 **Other**。
3. 点 **Deploy**。

### Step 3 — Update the HF repo name in `index.html` / 改 `index.html` 里的 HF 仓库名

```js
const HF_USER = "your-hf-username";
const HF_REPO = "your-hf-repo";
```

If you change these, redeploy on Vercel.

改完这两个变量后，Vercel 重新部署。

---

## Website features / 网页功能

- **Full-screen vertical scroll** — one video per screen, TikTok-style. / **全屏竖滑** —— 一屏一个视频，仿 TikTok。
- **Auto-play / auto-pause** — `IntersectionObserver` plays the visible video and pauses the rest. / **自动播放/暂停** —— `IntersectionObserver` 控制可见的播放、其余暂停。
- **Muted by default** — browsers block autoplay with sound. Click the video or the mute button to unmute. / **默认静音** —— 浏览器禁止有声自动播放。点视频或静音按钮取消静音。
- **Dynamic video list** — the page calls the HF API on load, so new uploads appear after a refresh, no code change needed. / **动态视频列表** —— 页面加载时调 HF API，新上传的视频刷新即出现，不用改代码。
- **End card** — when you reach the bottom, shows an English message with a link to this README. / **到底提示** —— 滑到底显示英文提示和本 README 链接。

---

## File overview / 文件说明

| File | Purpose / 作用 |
|---|---|
| `main.py` | TikTok feed capture + download / 抓取并下载 TikTok 视频 |
| `upload_hf.py` | Upload MP4 to HF, delete local / 上传 HF 并删本地 |
| `login.py` | One-time TikTok login helper / 一次性登录辅助 |
| `config.json` | Download path, count, concurrency / 下载路径、数量、并发 |
| `run.bat` | Full pipeline (download + upload) / 完整流程（下载 + 上传） |
| `login.bat` | Launch login helper / 启动登录 |
| `update.bat` | Install/update dependencies / 安装/更新依赖 |
| `index.html` | C0balt website (deployed to Vercel) / C0balt 网页（部署到 Vercel） |
| `perfil_navegador/` | Chrome session folder / Chrome 登录状态 |
| `videos.txt` | Temp file of intercepted URLs / 拦截到的链接临时文件 |

---

## Troubleshooting / 常见问题

### Videos don't play on the website / 网页上视频不播放
- Open DevTools Console. If you see a **CORS** error, Hugging Face may be blocking the request. Switch storage to Cloudflare R2 or Catbox. / 打开 DevTools Console，如果看到 **CORS** 错误，说明 Hugging Face 拦了请求。换 Cloudflare R2 或 Catbox。
- If you see **404**, the file name in `index.html` doesn't match the HF repo. / 如果看到 **404**，`index.html` 里的文件名和 HF 仓库不一致。

### No videos downloaded / 没抓到视频
- Run `login.bat` again — the TikTok session may have expired. / 重新跑 `login.bat` —— TikTok 登录状态可能过期了。
- Lower `descargas_simultaneas` to 3–4 to avoid rate limiting. / 把 `descargas_simultaneas` 降到 3–4，避免被限流。

### `Database is locked` error / `Database is locked` 错误
Close all Chrome windows before running `main.py`. The persistent context folder can only be used by one Chrome instance. / 跑 `main.py` 前关掉所有 Chrome 窗口。持久化文件夹只能被一个 Chrome 实例使用。

### `ffmpeg not found` / `ffmpeg 找不到`
Install ffmpeg: `winget install Gyan.FFmpeg`, then reopen PowerShell. / 装 ffmpeg：`winget install Gyan.FFmpeg`，然后重开 PowerShell。

---

## Disclaimer / 免责声明

This project is for **personal use and learning only**. Downloaded videos are copyrighted by their original creators. Do not redistribute them publicly. Do not use this tool to bypass access controls or violate TikTok's Terms of Service.

本项目**仅供个人使用和学习**。下载的视频版权归原作者所有，请勿公开传播。请勿使用本工具绕过访问控制或违反 TikTok 服务条款。
