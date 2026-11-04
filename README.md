# C0balt

仿 TikTok「For You」风格的全屏竖滑视频网站。本地用 TikPipe 抓取视频，转成 HLS（m3u8 + ts）上传到 Hugging Face，Vercel 托管的网页用 hls.js 播放。

---

```## 架构

text
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
TikPipe（main.py / download_only.py）：Playwright 打开带登录态的 Chrome，滚动 TikTok 页面，拦截 item_list / feed 接口的 JSON，把视频 URL 交给 yt-dlp 并发下载。

upload_hf.py：把本地 MP4 用 ffmpeg 转成 HLS（720p、30fps、crf 28、2 秒分片），上传到 HF 的 hls/{base}/，成功后删本地 MP4。

Vercel 网页：api/fetch-videos.js 列 hls/*/index.m3u8，代理 m3u8 时把分片路径改写成代理 URL，代理 ts 时透传 Range；index.html 用 hls.js 播放，分页加载、触底预取、每页随机、暂停/快进图标。

前置要求
Windows 10/11 (64-bit)

Python 3.10+（安装时勾选 Add python.exe to PATH）

Google Chrome（官方安装版）

一个 Hugging Face 账号

ffmpeg（winget install Gyan.FFmpeg，装完重开 PowerShell）

第一次配置
1. 安装依赖
双击 bats/update-requirements.bat，或运行：

cmd
python -m pip install -U -r requirements.txt
playwright install chromium
2. 设置 HF Token
双击 bats/set-token.bat，粘贴 token（Write 权限），回车。关掉所有 cmd / PowerShell 窗口重开才生效。

3. 创建 HF 仓库
去 https://huggingface.co/new 建一个 Model 仓库，比如 aiden12910/tiktok-videos，设为 Public。

4. 配置 config.json
json
{
    "ruta_descargas": "X:\\TikTok_Downloads",
    "cantidad_videos": 100,
    "descargas_simultaneas": 6,
    "source_url": "https://www.tiktok.com/foryou"
}
键	含义
ruta_descargas	下载目录（也兼容 download_path）
cantidad_videos	每次抓取目标数量（也兼容 video_count）
descargas_simultaneas	并发下载数，建议 4–8（也兼容 concurrent_downloads）
source_url	抓取来源，默认 For You（也兼容 url_origen）
5. 登录 TikTok（一次即可）
双击 bats/pre-login.bat，登录 Google 和 TikTok，关掉窗口。登录态保存到 perfil_navegador/。

6. 部署网页到 Vercel
把 index.html 和 api/fetch-videos.js 推到 GitHub 仓库。

https://vercel.com/new 导入该仓库，Framework Preset 选 Other，Deploy。

api/fetch-videos.js 顶部的 HF_USER / HF_REPO 必须和你的 HF 仓库一致。

改了这两个常量后，Vercel 重新部署。

日常使用
推荐双击 bats/main-menu.bat，所有操作集成在一个窗口，每步输 YES 确认：

菜单项	作用
1. Check / install dependencies	装/更新依赖
2. Show and change HF_TOKEN	显示当前 token，可覆盖修改
3. main-run.bat	抓视频 + 转 HLS + 上传 HF + 删本地
4. manual-upload.bat	只上传本地已有 MP4（转 HLS）
5. danger-delete-all.bat	删除 HF 仓库所有文件（双重确认）
6. Exit	退出
也可以单独双击：

文件	作用
bats/main-run.bat	抓 + 转 HLS + 上传 + 删本地
bats/download-only.bat	只抓取并下载，不上传
bats/manual-upload.bat	只上传本地 MP4（转 HLS），成功后删本地
bats/danger-delete-all.bat	删除 HF 仓库所有文件
bats/change-source.bat	修改 config.json 里的 source_url
bats/pre-login.bat	重新登录 TikTok
bats/set-token.bat	设置/覆盖 HF Token
bats/update-requirements.bat	安装/更新 Python 依赖和 Playwright Chromium
网页功能
全屏竖滑：一屏一个视频，scroll-snap 实现。

HLS 播放：hls.js 播 m3u8，maxBufferLength: 6、capLevelToPlayerSize: true 优先首屏。

自动播放 / 暂停：IntersectionObserver 控制可见视频播放、其余暂停。

暂停/快进图标：暂停时显示 ⏸，←/→ 快退/快进 10 秒时显示 ⏪/⏩。

默认静音：浏览器禁止有声自动播放，点视频或右侧按钮取消静音。

分页懒加载：每页 20 个，刷到倒数 10 条时自动预取下一页，显示加载动画。

每页随机：每页请求回来、渲染进 DOM 之前，本页 20 条随机洗牌；刷新页面顺序重新随机。

流式代理：m3u8 分片路径改写为代理 URL，ts 透传 Range，用户不直连 HF。

到底提示：滑到底显示 end card 或“暂无视频”。

文件说明
文件	作用
main.py	抓取 + 下载（完整流水线的下载阶段）
download_only.py	只抓取 + 下载，不上传
upload_hf.py	MP4 转 HLS（720p/30fps/crf 28），上传 HF，成功后删本地
delete_hf.py	删除 HF 仓库所有文件
login.py	一次性登录 TikTok，保存 session 到 perfil_navegador/
config.json	下载路径、数量、并发、来源 URL
videos.txt	运行时临时文件，记录拦截到的 URL，跑完自动清空
index.html	C0balt 网页前端（hls.js 播放）
api/fetch-videos.js	Vercel Serverless：action=list 列 m3u8，action=stream 代理 m3u8/ts
bats/main-menu.bat	集成菜单，所有操作在一个窗口
bats/*.bat	各项操作的独立入口
perfil_navegador/	Chrome 登录状态
requirements.txt	Python 依赖：yt-dlp / curl_cffi / playwright / huggingface_hub
常见问题
网页视频不播放

F12 Console 看错误。HLS 播放失败先看 action=stream&name=...index.m3u8 返回的是 m3u8 文本还是视频；如果是视频，说明 name.endsWith('.m3u8') 判断没生效，检查 api/fetch-videos.js 是否用 decodeURIComponent(req.query.name)。

404 → 检查 HF_USER / HF_REPO 是否和 HF 仓库一致。

上传报 Too Many Requests

HF 的 commit 限流（128 次/小时）。等约 1 小时重跑，upload_folder 会跳过已上传的。

upload_hf.py 每个视频一次 upload_folder，553 个视频分几小时跑，或一次跑 100 个左右。

没抓到视频

重新跑 pre-login.bat，TikTok 登录态可能过期。

把 descargas_simultaneas 降到 3–4。

换了 source_url 后没有 Intercepted and queued → 该页面接口不是 item_list / feed，需要 F12 Network 看实际 XHR URL，把关键字加进拦截条件。

Database is locked

跑 main.py 前关掉所有 Chrome 窗口。

ffmpeg not found

winget install Gyan.FFmpeg，然后重开 PowerShell。

Token 相关

换 token：bats/set-token.bat 覆盖写入，然后关掉所有终端重开。

怀疑泄露：去 https://huggingface.co/settings/tokens Revoke 旧的，生成新的，再 set-token.bat。

免责声明
本项目仅供个人使用和学习。下载的视频版权归原作者所有，请勿公开传播。请勿使用本工具绕过访问控制或违反 TikTok 服务条款。
