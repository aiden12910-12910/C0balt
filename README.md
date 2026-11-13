# C0balt

仿 TikTok「For You」风格的全屏竖滑视频网站。本地用 TikPipe 从 TikTok 抓取视频，用 ffmpeg 转成 HLS（m3u8 + ts），上传到 Hugging Face，Cloudflare Workers 托管的网页用 hls.js 播放。

A TikTok-style full-screen vertical video feed. Videos are captured locally from TikTok, converted to HLS with ffmpeg, uploaded to Hugging Face, and played on a Cloudflare Workers-hosted website using hls.js.

---

## 架构 / Architecture
```
本地 (Windows)                              云端 (Cloudflare)
─────────────────                          ─────────────────────────────
TikTok ──Playwright 拦截──▶ yt-dlp 下载
                                  │
                                  ▼
                         config.json 的 ruta_descargas (MP4)
                                  │
                         convert.py：先检测编码
                         H.264+AAC 走 -c copy（不重编码）
                         其他走 libx264 重编码
                         清晰度 low/medium/high，缩放 mechanical/auto
                                  │
                                  ▼
                         config.json 的 hls_output_dir (index.m3u8 + seg_*.ts)
                                  │
                         upload.py：每 50 个一组 upload_folder
                         候选仓库 0-3（正常）/ 4（测试）
                                  │
                                  ▼
                         Hugging Face
                         tiktok-videos / -1 / -2 / -3（正式）
                         tiktok-videos-4（测试）
                         hls/{base}/index.m3u8 + seg_*.ts
                                  │
                                  │  /api/models/...  列 m3u8
                                  │  /resolve/main/... 取 m3u8/ts
                                  ▼
                         Cloudflare Workers (C0balt)
                         src/index.js 代理 m3u8/ts
                         public/index.html hls.js 播放
```
- download.py：Playwright 打开带登录态的 Chrome，滚动 TikTok 页面，拦截 item_list / feed 接口的 JSON，把视频 URL 交给 yt-dlp 并发下载 MP4 到 config.json 的 ruta_descargas。支持分批拦截，每批结束问是否继续，答 N 后统一进入下载阶段。
- convert.py：先 ffprobe 检测每个 MP4 的编码、分辨率、时长。H.264+AAC 走 -c copy 不重编码（快、画质不变），其他编码走 libx264 重编码。先转可 copy 的，提示后再转需重编码的。支持 --quality low/medium/high 和 --scaling mechanical/auto。默认不删源 MP4；加 --delete-source 才在转换成功后删。
- upload.py：每 50 个视频一组，upload_folder 到 HF 的 hls/，成功后删该组本地 HLS。--mode normal（默认）只从 0–3 号正式库按顺序试、满了跳下一个，4 号测试库被排除；--mode test 只上传到 4 号测试库。支持 --convert 先转再传（和 convert.py 一样的两阶段），也支持只上传。加 --delete-source 时转换成功后删源 MP4。启动时会自动清 _upload_* 残留，删除失败会打印 [warn]。
- release.py：把当前目录（TikPipe-main）打包成 zip，创建 GitHub Release 并上传附件。配合 bats/release.bat 使用。
- Cloudflare Workers 网页：src/index.js 列 hls/*/index.m3u8，repo=all 排除 4 号测试库，单独选 tiktok-videos-4 时只返回测试库；代理 m3u8 时把分片路径改写成代理 URL，代理 ts 时透传 Range；public/index.html 用 hls.js 播放，分页加载、触底预取、每页随机、暂停/快进图标、顶部仓库下拉切换。

---

## 前置要求 / Prerequisites

- Windows 10/11 (64-bit)
- Python 3.10+（安装时勾选 Add python.exe to PATH）
- Node.js 18+（winget install -e --id OpenJS.NodeJS.LTS，装完重开终端，npx 才能用）
- Google Chrome（官方安装版）
- 一个 Hugging Face 账号
- ffmpeg（winget install Gyan.FFmpeg，装完重开 PowerShell）

---

## 第一次配置 / First-time setup

### 1. 安装依赖

双击 bats/update-requirements.bat，或运行：

python -m pip install -U -r requirements.txt
playwright install chromium

### 2. 设置 HF Token

双击 bats/set-token.bat，粘贴你的 token（Write 权限），回车。setx 写入用户环境变量后，关掉所有已打开的 cmd / PowerShell 窗口，重开才生效。验证：

echo $env:HF_TOKEN

### 3. 创建 HF 仓库

去 https://huggingface.co/new 建 Model 仓库，设为 Public：

仓库                                用途
aiden12910/tiktok-videos            正式库 0
aiden12910/tiktok-videos-1          正式库 1
aiden12910/tiktok-videos-2          正式库 2
aiden12910/tiktok-videos-3          正式库 3
aiden12910/tiktok-videos-4          测试库（--mode test 专用，网页下拉可选）

不建 4 号也能正常用，只是没有测试库。

### 4. 配置 config.json
```
{
    "ruta_descargas": "X:\\TikTok_Downloads",
    "hls_output_dir": "X:\\TikTok_HLS",
    "tikpipe_dir": "TikPipe-main",
    "cantidad_videos": 100,
    "descargas_simultaneas": 6,
    "source_url": "https://www.tiktok.com/foryou"
}
```
键                          含义
ruta_descargas              下载目录（也兼容 download_path）
hls_output_dir              HLS 输出目录
tikpipe_dir                 release.py 打包的目标文件夹
cantidad_videos             每次抓取目标数量（也兼容 video_count）
descargas_simultaneas       并发下载数，建议 4–8（也兼容 concurrent_downloads）
source_url                  抓取来源，默认 For You（也兼容 url_origen）

### 5. 登录 TikTok（一次即可）

双击 bats/pre-login.bat，弹出 Chrome。登录 Google 和 TikTok，然后关掉窗口。登录态保存到 perfil_navegador/。

运行 download.py 前关掉其他 Chrome 窗口，否则会报 Database is locked。

### 6. 部署网页到 Cloudflare Workers

项目结构：
```
TikPipe-main/
├── wrangler.jsonc
├── public/
│   └── index.html
└── src/
    └── index.js
```
1. 把 wrangler.jsonc、public/index.html、src/index.js 推到 GitHub 仓库。
2. 终端在项目根目录跑：

npx wrangler login
npx wrangler deploy

3. 部署成功会输出 https://c0balt.xxx.workers.dev，先打开这个地址验证页面和播放。
4. 在 Cloudflare 控制台 → Workers & Pages → c0balt → Settings → Domains & Routes → Add → Custom Domain，填 c0balt.uran1um.dpdns.org，Cloudflare 自动配 DNS 和 SSL。
5. src/index.js 顶部的 HF_USER / HF_REPOS 必须和你的 HF 仓库一致，改了之后重新 npx wrangler deploy。

本地 Python 脚本（download.py / convert.py / upload.py / release.py）不需要部署，装好依赖、配好 config.json 后直接双击 bats/ 里的 bat 运行即可。只有网页侧（public/index.html + src/index.js）需要推到 GitHub 并部署到 Cloudflare Workers。

---

## 日常使用 / Daily use

推荐双击 bats/main-menu.bat，所有操作集成在一个窗口，每步都要输入 YES 确认：

菜单项                                        作用
1. Check / install dependencies               装/更新依赖
2. Show and change HF_TOKEN                   显示当前 token（只显示前 8 位），可覆盖修改
3. Download only (capture MP4)                只抓取并下载 MP4
4. Convert only (MP4 → HLS)                   只转换，输出到 hls_output_dir（问清晰度、缩放模式、是否删源）
5. Upload only (HLS → HF)                     只上传 hls_output_dir 里已有的 HLS（问正常/测试）
6. Convert + Upload                           转换 + 上传（问清晰度、缩放模式、上传目标、是否删源；10 并发转换，50 个一组上传）
7. DANGER: Delete ALL FILES from HF           删除 HF 仓库所有文件（双重确认）
8. Exit                                       退出

也可以单独双击：

文件                                          作用
bats/download-only.bat                        只抓取并下载 MP4，不转换、不上传
bats/convert-only.bat                         只转换：MP4 → HLS。会问清晰度、缩放模式、是否删源 MP4
bats/upload-only.bat                          只上传：hls_output_dir → HF hls/。会问正常/测试
bats/convert-and-upload.bat                   转换 + 上传。会问清晰度、缩放模式、上传目标、是否删源 MP4
bats/danger-delete-all.bat                    删除 HF 仓库所有文件
bats/change-source.bat                        修改 config.json 里的 source_url
bats/pre-login.bat                            重新登录 TikTok
bats/set-token.bat                            设置/覆盖 HF Token
bats/update-requirements.bat                  安装/更新 Python 依赖和 Playwright Chromium
bats/not-sleep.bat                            禁止睡眠和关屏，按任意键恢复
bats/release.bat                              打包当前目录并创建 GitHub Release（需要 GITHUB_TOKEN）

清晰度三档：

档位      机械模式（默认）                          自动模式（相对原视频）
low       426×240 / 15fps / crf 40 / 48k            原分辨率 ×0.4、原 fps ×0.5、crf 40 / 48k
medium    854×480 / 24fps / crf 28 / 96k            原分辨率 ×0.7、原 fps ×0.8、crf 28 / 96k
high      1280×720 / 30fps / crf 23 / 128k          原分辨率 ×1.0、原 fps ×1.0、crf 23 / 128k

缩放模式：

- mechanical（默认，回车）：固定参数，和上表“机械模式”一致，速度可预测。
- auto：按原视频分辨率/fps 相对缩放，低清源不会被压得太烂，高清源不会被压得太狠，但输出分辨率随源变化，速度不固定。

H.264+AAC 的视频走 -c copy，不重编码，选哪档、哪种缩放模式都不影响画质，只影响非 H.264 的视频。

上传模式：

模式              命令                                  候选仓库                              用途
normal（默认）    python upload.py 或 --mode normal     tiktok-videos、-1、-2、-3             正式发布，4 号测试库不碰
test              python upload.py --mode test          tiktok-videos-4                       测试上传，不影响正式库 commit 限流

- 正常模式按 0 → 1 → 2 → 3 顺序试，一个满了自动跳下一个。
- 测试库和正式库独立计算 commit 限流（128 次/小时），互不影响。
- 网页顶部下拉框可以切到 tiktok-videos-4 单独看测试库，或选 all 合并正式库（不含 4 号）。

目录约定：

目录                                用途
config.json 的 ruta_descargas       下载的原始 MP4（download.py 写入，convert.py 读取）
config.json 的 hls_output_dir       转换后的 HLS（convert.py / upload.py --convert 写入，upload.py 上传后删）
hls_output_dir\_errors              转换失败时 ffmpeg 的完整 stderr
hls_output_dir\_upload_gN           上传时的临时分组目录，成功后自动删；中断残留会在下次 upload.py 启动时自动清
_copy_list.txt / _reencode_list.txt 转换时临时记录可 copy / 需重编码的文件，跑完自动删除

默认不删源 MP4。要转换成功后删除，加 --delete-source，或在 bat 里输 Y。

上传策略：upload.py 每 50 个视频一组，把这一组的 HLS 目录复制到 _upload_gN，一次 upload_folder 上传到 HF hls/，成功后删 _upload_gN 和该组本地 HLS。失败时整组保留，可重跑。HF 的 commit 限流是 128 次/小时，50 个一组后 commit 数很少，基本不会撞限流。

---

## 网页功能 / Website features

- 全屏竖滑：一屏一个视频，scroll-snap 实现。
- HLS 播放：hls.js 播 m3u8，maxBufferLength: 6、capLevelToPlayerSize: true 优先首屏、限制码率。
- 自动播放 / 暂停：IntersectionObserver 控制可见视频播放、其余暂停。
- 暂停/快进图标：暂停时显示 ⏸，←/→ 快退/快进 10 秒时显示 ⏪/⏩，空格暂停/播放。
- 默认静音：浏览器禁止有声自动播放，点视频或右侧按钮取消静音。
- 分页懒加载：每页 20 个，刷到倒数 10 条时自动预取下一页，显示加载动画。
- 每页随机：每页请求回来、渲染进 DOM 之前，本页 20 条随机洗牌；刷新页面顺序重新随机。
- 流式代理：m3u8 分片路径改写为代理 URL，ts 透传 Range，用户不直连 HF。
- 多仓库切换：顶部下拉框可选 tiktok-videos 到 -4，或 all；all 不含 4 号测试库，切到 tiktok-videos-4 单独看测试库；切换后重新从第 0 页加载。
- 错误处理：视频 error 时断点重试最多 3 次，仍失败显示错误覆盖层；列表加载失败显示重试按钮；空列表显示“暂无视频”。
- 到底提示：滑到底显示 end card 或“暂无视频”。

---

## 文件说明 / File overview
```
文件                                作用
download.py                         抓取 + 下载 MP4，支持分批拦截
convert.py                          MP4 → HLS。检测编码，H.264+AAC 走 copy，其他重编码；清晰度 low/medium/high，缩放 mechanical/auto；默认不删 MP4
upload.py                           只上传 / 转换+上传；--mode normal 用 0–3 正式库，--mode test 只用 4 号测试库；50 个一组上传，成功后删本地 HLS，启动时自动清 _upload_* 残留
delete_hf.py                        删除 HF 仓库所有文件（包括 hls/ 下的 m3u8 和 ts）
release.py                          打包当前目录并创建 GitHub Release + 上传 zip 附件
login.py                            一次性登录 TikTok，保存 session 到 perfil_navegador/
progress.py                         单行实时刷新进度条，后台线程每 0.5 秒重绘
config.json                         下载路径、HLS 输出路径、打包目录、数量、并发、来源 URL
videos.txt                          运行时临时文件，记录拦截到的 URL，跑完自动清空
public/index.html                   C0balt 网页前端（hls.js 播放、仓库下拉）
src/index.js                        Cloudflare Workers：action=list 列 m3u8（repo=all 排除 4 号测试库），action=stream 代理 m3u8/ts
wrangler.jsonc                      Cloudflare Workers 配置：main、assets.directory、可选的 kv_namespaces
bats/main-menu.bat                  集成菜单，所有操作在一个窗口
bats/*.bat                          各项操作的独立入口（见上表）
perfil_navegador/                   Chrome 登录状态
requirements.txt                    Python 依赖：yt-dlp / curl_cffi / playwright / huggingface_hub
```
---

## 常见问题 / Troubleshooting

网页视频不播放
- F12 Console 看错误。HLS 播放失败先看 action=stream&name=...index.m3u8 返回的是 m3u8 文本还是视频；如果是视频，说明 name.endsWith('.m3u8') 判断没生效，检查 src/index.js 是否用 decodeURIComponent(url.searchParams.get('name'))。
- 404 → 检查 src/index.js 里的 HF_USER / HF_REPOS 是否和 HF 仓库一致。
- 切了仓库下拉但列表空 → 该仓库确实没有 hls/*/index.m3u8，或仓库名拼错。

npx wrangler deploy 报 Cannot use assets with a binding in an assets-only Worker
- wrangler.jsonc 里写了 assets.binding 但没写 main。加上 "main": "src/index.js" 即可。

上传报 Too Many Requests
- HF 的 commit 限流（128 次/小时）。等约 1 小时重跑 bats/upload-only.bat，upload_folder 会跳过已上传的、只补传剩余。
- upload.py 每 50 个一组，398 个视频大约 8 组，commit 数很少，正常不会撞限流。
- 测试库 4 号和正式库独立限流，测试上传不影响正式库配额。

上传成功但本地 HLS 没删
- 控制台看有没有 [warn] 删除本地 HLS ... 失败（可能被占用）。有就是文件被 ffmpeg 残留、播放器、资源管理器预览锁住。
- 关掉占用程序，手动删 hls_output_dir\{base}\，或下次跑 upload.py 时会自动清 _upload_* 残留（但不自动删 {base}）。

hls_output_dir 下残留 _upload_gN
- 上传成功但删临时目录前窗口被关掉。下次跑 upload.py 启动时 cleanup_stale_upload_dirs() 会自动清，或手动 Get-ChildItem "hls_output_dir" -Directory -Filter "_upload_*" | Remove-Item -Recurse -Force。

转换报 [WinError 32] 另一个程序正在使用此文件
- 关掉播放器、资源管理器预览、残留的 ffmpeg 进程，等几秒重跑 convert.py。已转好的会跳过，被占用的会重新尝试。
- 查残留 ffmpeg：Get-Process ffmpeg -ErrorAction SilentlyContinue，有就 Stop-Process -Name ffmpeg -Force。

转换报 Conversion failed!
- 看 hls_output_dir\_errors\{base}.log，里面是 ffmpeg 的完整 stderr。常见是源 MP4 尾部损坏或不完整，重新下载该视频再转。

转换进度条“突然跳到 70%”
- 进度按“源视频秒数”算，不按个数。可 copy 的视频虽然数量少，但时长可能占大头，copy 阶段一结束，百分比就到 70% 左右，reencode 阶段每个视频短，百分比涨得慢、个数涨得快。这是正常的。

没抓到视频
- 重新跑 pre-login.bat，TikTok 登录态可能过期。
- 把 descargas_simultaneas 降到 3–4。
- 换了 source_url 后终端里没有 Intercepted and queued → 该页面的列表接口不是 item_list / feed，需要 F12 Network 看实际 XHR URL，把关键字加进 download.py 的拦截条件。

Database is locked
- 跑 download.py 前关掉所有 Chrome 窗口，perfil_navegador/ 只能被一个 Chrome 实例使用。

ffmpeg not found
- winget install Gyan.FFmpeg，然后重开 PowerShell。

npx 不是命令 / wrangler 找不到
- 没装 Node.js。winget install -e --id OpenJS.NodeJS.LTS，装完关掉所有终端重开。验证 node -v、npm -v、npx -v。

Token 相关
- 换 HF token：bats/set-token.bat 覆盖写入，然后关掉所有终端重开。
- 怀疑泄露：去 https://huggingface.co/settings/tokens Revoke 旧的，生成新的再设。

发布 Release 报 401 / 403
- GITHUB_TOKEN 没设、过期、或权限不够。fine-grained token 需要 Contents: Read and write；classic token 需要 repo 勾选。
- 确认 release.py 顶部 REPO = "aiden12910-12910/C0balt" 和你的仓库一致。

发布 Release 报 422
- 该 tag 已存在。换一个新 tag（如 v1.0.1），或先去 GitHub 删掉旧 release/tag。

下载整个 HF 仓库
- 用 hf download aiden12910/tiktok-videos --repo-type model --include "hls/*" --local-dir X:\TikTok_HLS_Backup，只下 HLS，不碰旧 MP4。

---

## 免责声明 / Disclaimer
```
本项目仅供个人使用和学习。下载的视频版权归原作者所有，请勿公开传播。请勿使用本工具绕过访问控制或违反 TikTok 服务条款。

This project is for personal use and learning only. Downloaded videos are copyrighted by their original creators. Do not redistribute them publicly. Do not use this tool to bypass access controls or violate TikTok's Terms of Service.
```
