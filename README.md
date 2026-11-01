# Framing Cam

A portrait camera that runs in the mobile browser. No install. Someone else holds the phone. The screen shows a dashed figure where the person should stand and a solid figure where they are now. An arrow says which way to move the phone, and how far. When the two figures overlap, the bar and the shutter ring turn green and, with auto on, it shoots.

The final photo is a real crop of the camera frame, not an upscale. If the person is too small to crop cleanly, the page asks the holder to step closer.

**Inspired by the idea of real-time composition guidance in [Doka Cam](https://www.yindoka.com/official/).** This is an independent open-source implementation. It is not affiliated with Doka or its makers, and it does not copy their interface, models, or assets.

[中文说明](#中文)

## Try it on a phone

GitHub Pages: [https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/). Open it in **iOS Safari** or **Android Chrome**. That build has no server, so cloud refine stays off and framing stays on the phone. A Netlify deploy can turn cloud refine on; see [Deploy](#deploy).

1. Tap **打开相机**. Allow the camera, and on iPhone allow motion access so the horizon can be leveled.
2. Choose **拍别人** (rear camera) or **自拍** (front camera). In the first mode the words tell the holder how to move the phone, such as 手机往左 or 往前走一步. Selfie mode speaks the cue and counts 3-2-1.
3. The ring turns green and, with **自动** on, the shutter fires. Tap the shutter any time.
4. Save the current frame, or save all three: **4:5**, **3:4**, and **9:16**. On iPhone you can also long-press the photo.

**先看演示** runs the same coach against a drawn figure, so you can try the guidance without a camera. `?demo=auto` plays that loop by itself. `?lang=en` starts in English. The default language is Simplified Chinese.

## How it works

On the phone, MediaPipe Pose and Face Landmarker run in a Web Worker at about 15 fps. From the landmarks the page builds a portrait plan:

- eyes near the upper third
- a little room above the hair
- the frame does not cut knees, elbows, wrists, ankles, or the neck
- looking room when the nose points to one side
- the phone held level, using the motion sensors

As soon as a person is found — a face alone is enough — the phone picks a sensible default plan and draws it as the dashed figure. Style is optional. Hold the round button and talk (it sends itself when you let go, or when the browser hears silence), or type a look such as 氛围感, 搞笑, 唯美, 显腿长 and press return. Two to four plans appear as silhouette cards. The selected card is the target. Distance is corrected before position. Auto-capture waits until the figures match and the phone is steady, and it keeps a few recent frames so it can keep the sharpest one. If the scene changes away from the plan, a small banner says **画面变了，重新分析**. With no API key, the plans are built on the phone. A faint dot at the lower right opens a detector line: ok or not, CPU or GPU, fps, and the last error. iPhone and iPad start on the CPU delegate.

Large errors move the phone. Small errors are finished by a digital crop. The crop is not allowed to throw away so many pixels that the photo goes soft; past that limit the cue is **靠近**.

The GitHub Pages build never calls a server. Framing, the crop, and the shutter all stay on the phone. Netlify (and the local dev server) can ask a vision model for shot plans when `LLM_API_KEY` is set. A plan is kept only if it has a usable target box. With no key, nothing is uploaded and the on-device plans are used.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local development

```bash
npm install
npm test
npm run dev          # http://localhost:5173/  (set VITE_BASE=/framing-cam/ to match Pages)
npm run dev:https    # https on your LAN, self-signed certificate
```

`npm install` copies the MediaPipe wasm runtime into `public/vendor/wasm`. The pose and face models are already in `public/vendor/models`, so the phone does not have to download them from Google at runtime.

### Phone on the same Wi-Fi

Self-signed HTTPS (`npm run dev:https`) is enough for many Android phones: open `https://<your-lan-ip>:5173/` and continue past the warning.

iOS Safari is stricter. A certificate you trust locally is more reliable:

```bash
brew install mkcert   # or your platform's mkcert package
mkcert -install
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 192.168.1.20
npm run dev:mkcert
```

Use your computer's LAN address in the `mkcert` command. Install the mkcert root CA on the iPhone (mkcert's docs describe this), then open `https://192.168.1.20:5173/`.

Desktop `http://localhost:5173/` is a secure context, so the camera works there without HTTPS. Another computer on the LAN using plain `http://192.168.x.x` is not a secure context, and `getUserMedia` will fail.

The dev server exposes `GET /api/health` and `POST /api/frame`. Copy `.env.example` to `.env` to try a cloud crop locally. Leave `LLM_API_KEY` empty and the app stays rules-only.

## Deploy

The Vite `base` comes from `VITE_BASE` (default `/`). GitHub Pages sets `/framing-cam/`. Netlify sets `/`.

### GitHub Pages

[https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/)

Pushing `main` runs `.github/workflows/pages.yml` with `VITE_BASE=/framing-cam/` and deploys `dist` via `actions/deploy-pages`. In the repository settings, set Pages → Build and deployment → Source to **GitHub Actions**.

That build does not set `VITE_CLOUD`, so it never calls `/api`. Cloud refine stays off, with no failed request. Models and wasm load from `/framing-cam/vendor/...`.

### Netlify

`netlify.toml` builds the app, publishes `dist`, and serves `netlify/functions` at `/api/health` and `/api/frame`. From the repo root, with only an auth token and a site id:

```bash
NETLIFY_AUTH_TOKEN=... NETLIFY_SITE_ID=... npx netlify-cli deploy --prod --build
```

Set these in the Netlify site environment (not in the client bundle):

| Variable | Purpose |
| --- | --- |
| `LLM_API_KEY` | Empty disables cloud refine. The health check returns `llm: false` and the button stays off. |
| `LLM_PROVIDER` | `openai` (default), `openai-compatible`, `anthropic`, `dashscope` (aliases `qwen`, `qwen-vl`), `doubao` (aliases `volcengine`, `ark`) |
| `LLM_BASE_URL` | Optional override. DashScope preset: `https://dashscope.aliyuncs.com/compatible-mode/v1`. Doubao preset: `https://ark.cn-beijing.volces.com/api/v3`. |
| `LLM_MODEL` | Optional override. DashScope preset: `qwen-vl-max`. Doubao preset: `doubao-seed-2-1-pro-260628`, or your Ark endpoint id `ep-...`. |

The key never reaches the browser. International DashScope is the same provider with `LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`.

## Tests

```bash
npm test
npm run build
```

Unit tests cover the coach (which way to move, including the mirrored selfie preview), crop aspect ratio, joint clearance, a closed loop that walks a bad framing to “ready”, steady detection, the cloud-box safety check, and a painted sample portrait in `tests/fixtures/portrait-sample.png`. The crop is checked against the pixels of that image, not only against the landmark numbers used to draw it.

## Limitations

- iOS and mobile Chrome only expose the camera on HTTPS (or localhost). Stream resolution is whatever `getUserMedia` allows — often 1080p or 4K, not the full still-photo sensor. A still capture from `ImageCapture.takePhoto()` can disagree with the video field of view, so the crop is taken from the same frame the coach saw.
- Hardware zoom constraints are uneven (mainly iOS 17+) and enlarge by throwing pixels away. This app does not use them. It crops digitally inside a limit, and asks the holder to step closer past that.
- The level guide needs motion permission. iOS has no vibration API. Voice uses the system speech voices that are installed.
- Pose and face try the GPU on desktop and fall back to CPU if a frame fails. iPhone and iPad start on CPU. Wasm and the `.task` models are served from this site (`/vendor`), not from a CDN. Camera frames are copied as pixels. Detection runs in a worker, and if that worker cannot start (iOS Safari has no `document` inside a worker), the same pose and face models run on the main thread. The failure reason stays on screen only when both fail. A close-up that shows only a face still counts as a person.
- The aesthetic ranker is a portrait rule scorer in the spirit of learned crop rankers such as GAIC, not a shipped neural ranking model. A network that large is a poor fit for a first paint on a phone, and the rules are testable.
- One primary subject. Tap another face to switch. The coach does not direct the person being photographed, only the person holding the phone.
- No filters, relighting, or beauty retouch. That is deliberate.
- A tilted or sideways video buffer on a particular Android build can misalign the overlay. The crop and the overlay use the same buffer, so they still match each other.
- GitHub Pages does not upload frames. On Netlify, cloud refine runs only when `LLM_API_KEY` is set; a bad box is dropped if it misses the head or cuts a joint. Doubao's default model id is dated — set `LLM_MODEL` to the vision model or endpoint id enabled on your Ark account.

## License

MIT. MediaPipe runtime and landmarker models are Apache-2.0, see `public/vendor/NOTICE`.

---

# 中文

构图相机是一个跑在手机浏览器里的人像相机，不用安装。朋友拿着手机，屏幕上有两条人影：虚线是该站的位置，实线是现在的人。箭头表示手机往哪边挪、挪多少。两条线重合后，进度条和快门环变绿；开着自动时就会拍。

成片是从相机画面里裁出来的，不会把一小块放大到发糊。人如果太小，页面会请拿手机的人走近。

**产品思路受 [Doka 相机](https://www.yindoka.com/official/) 的实时构图引导启发。** 这是独立的开源实现，与 Doka 及其开发者没有关联，也不复制对方的界面、模型或素材。

## 在手机上试用

GitHub Pages：[https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/)。用 **iOS Safari** 或 **Android Chrome** 打开。这个构建没有服务器，云端微调保持关闭，构图在手机上完成。若要打开云端微调，用 Netlify，见 [部署](#部署)。

1. 点 **打开相机**。允许摄像头；在 iPhone 上再允许动作与方向，才能校正地平线。
2. 顶部选 **拍别人**（后置）或 **自拍**（前置）。拍别人时文字是给拿手机的人的，例如「手机往左」「往前走一步」。自拍会朗读提示，对准后 3、2、1 再拍。
3. 圆环变绿后，开着 **自动** 就会拍。也可以随时按快门。
4. 保存当前画幅，或一次保存 **4:5**、**3:4**、**9:16**。iPhone 上也可以长按照片保存。

**先看演示** 用一个画出来的人走同一套引导，没有相机也能看提示。地址加上 `?demo=auto` 会自动把人物走到可拍的位置。`?lang=en` 使用英文。默认语言是简体中文。

## 它怎么工作

手机里，MediaPipe 的姿势和人脸关键点在 Web Worker 中大约每秒 15 帧运行。页面据此做一张人像构图：

- 眼睛靠近上三分线
- 头顶留一点空间
- 不在膝盖、手肘、手腕、脚踝或脖子处下刀
- 鼻子偏向一侧时，给视线留空
- 用运动传感器把手机摆平

只要认出人（只有脸的特写也算），手机会先放上一个默认方案，画成虚线人影。风格是可选的。按住圆钮说话，松手或检测到静音后会自己送出；也可以打字（氛围感、搞笑、唯美、显腿长）后回车。两到四个方案是人影缩略图，点一张就换成那条虚线。先把远近走对，再挪位置。自动拍摄会等到人影重合并且手机稳定，并在最近几帧里留下更清晰的一张。画面如果偏离了当时的方案，会出现 **画面变了，重新分析**。没有密钥时，方案在手机上生成。右下角有一个淡点，点开能看到检测是否成功、CPU 还是 GPU、帧率，以及最近一次错误。iPhone 和 iPad 从 CPU 开始检测。

偏差大的时候，移动手机来补。剩下的小偏差用数字裁切收干净。裁切不允许丢掉太多像素；超过限度就提示 **靠近**。

GitHub Pages 上的版本不会请求服务器。构图、裁切和快门都在手机里完成。Netlify 和本地开发服务器在设置了 `LLM_API_KEY` 时，可以请视觉模型给拍摄方案。方案必须带可用的目标框才会被采用。没有密钥时不上传画面，改用手机上的方案。

细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 本地开发

```bash
npm install
npm test
npm run dev          # http://localhost:5173/  （要和 Pages 一样的子路径就设 VITE_BASE=/framing-cam/）
npm run dev:https    # 局域网 HTTPS，自签证书
```

`npm install` 会把 MediaPipe 的 wasm 复制到 `public/vendor/wasm`。姿势和人脸模型已经放在 `public/vendor/models`，手机运行时不必再去 Google 下载。

### 同一 Wi-Fi 下的手机

很多 Android 手机用 `npm run dev:https` 即可：打开 `https://<电脑局域网 IP>:5173/`，忽略证书警告。

iOS Safari 对自签证书很严。更稳妥的是本地信任的证书：

```bash
brew install mkcert   # 或其他平台的 mkcert
mkcert -install
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 192.168.1.20
npm run dev:mkcert
```

把命令里的地址换成你电脑的局域网 IP。按 mkcert 的说明把根证书装到 iPhone 上，然后打开 `https://192.168.1.20:5173/`。

电脑上的 `http://localhost:5173/` 属于安全上下文，不装 HTTPS 也能开相机。局域网里用 `http://192.168.x.x` 则不是安全上下文，`getUserMedia` 会失败。

开发服务器提供 `GET /api/health` 和 `POST /api/frame`。把 `.env.example` 复制为 `.env` 即可在本地试云端裁切。`LLM_API_KEY` 留空时只用本机构图。

## 部署

Vite 的 `base` 来自环境变量 `VITE_BASE`（默认 `/`）。GitHub Pages 设为 `/framing-cam/`，Netlify 设为 `/`。

### GitHub Pages

地址：[https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/)

推送到 `main` 会运行 `.github/workflows/pages.yml`，以 `VITE_BASE=/framing-cam/` 构建，再用 `actions/deploy-pages` 发布 `dist`。仓库设置里把 Pages → Build and deployment → Source 选成 **GitHub Actions**。

这个构建不设置 `VITE_CLOUD`，因此不会请求 `/api`。云端微调保持关闭，也不会出现失败请求。模型和 wasm 从 `/framing-cam/vendor/...` 加载。

### Netlify

`netlify.toml` 负责构建、把 `dist` 作为发布目录，并把 `netlify/functions` 挂到 `/api/health` 和 `/api/frame`。在仓库根目录，只需要令牌和站点 id：

```bash
NETLIFY_AUTH_TOKEN=... NETLIFY_SITE_ID=... npx netlify-cli deploy --prod --build
```

在 Netlify 站点的环境变量里配置（不会打进前端包）：

| 变量 | 作用 |
| --- | --- |
| `LLM_API_KEY` | 留空则关闭云端微调。健康检查返回 `llm: false`，按钮保持关闭。 |
| `LLM_PROVIDER` | `openai`（默认）、`openai-compatible`、`anthropic`、`dashscope`（别名 `qwen`、`qwen-vl`）、`doubao`（别名 `volcengine`、`ark`） |
| `LLM_BASE_URL` | 可选。DashScope 预设：`https://dashscope.aliyuncs.com/compatible-mode/v1`。豆包预设：`https://ark.cn-beijing.volces.com/api/v3`。 |
| `LLM_MODEL` | 可选。DashScope 预设：`qwen-vl-max`。豆包预设：`doubao-seed-2-1-pro-260628`，或方舟接入点 `ep-...`。 |

密钥不会到浏览器。国际站 DashScope 用同一 provider，把 `LLM_BASE_URL` 设为 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`。

## 测试

```bash
npm test
npm run build
```

单元测试覆盖：该往哪边移动（含前置摄像头的镜像）、画幅比例、关节是否被切断、从很差的构图走到「可以拍了」的闭环、稳定检测、云端裁切框的安全校验，以及 `tests/fixtures/portrait-sample.png` 里画出来的一张人像。裁切结果会对照这张图的像素检查，而不只是对照用来画画的坐标。

## 已知限制

- iOS 和手机 Chrome 只在 HTTPS（或 localhost）上提供相机。`getUserMedia` 的分辨率通常是 1080p 或 4K 这一档，不是传感器的完整静物分辨率。`ImageCapture.takePhoto()` 的视野可能和预览不一致，所以裁切使用的是引导所看到的那一帧。
- 硬件变焦约束并不普遍（主要是 iOS 17 及以后），而且变焦会丢掉像素。本应用不用它。数字裁切有上限，超过就请拿手机的人走近。
- 水平校正需要动作传感器权限。iOS 没有振动接口。语音依赖系统里已安装的语音包。
- 桌面端姿势和人脸先试 GPU，某一帧失败就改用 CPU。iPhone 和 iPad 从 CPU 开始。wasm 和 `.task` 模型由本站的 `/vendor` 提供，不走外部 CDN。相机帧按像素拷进识别。识别先在 Worker 里跑；如果 Worker 起不来（iOS Safari 的 Worker 里没有 `document`），同一套姿势和人脸模型改在主线程跑。只有两边都失败时，原因才留在画面上。只有脸的特写也算一个人。
- 审美排序是一套人像规则打分，思路接近 GAIC 这类「给裁切打分再排序」的方法，但没有附带一个神经网络排序模型。那样的模型太大，不适合手机上的第一次打开，而这套规则可以被测试。
- 默认只跟一个主体。点另一张脸可以切换。引导只对拿手机的人说话，不指挥被拍的人摆姿势。
- 没有滤镜、补光或美颜。这是有意为之。
- 个别 Android 机型的视频缓冲方向若和预览不一致，叠层可能对不齐。裁切和叠层使用同一块缓冲，因此它们彼此仍然一致。
- GitHub Pages 不会上传画面。Netlify 上只有设置了 `LLM_API_KEY` 才会做云端微调；没包住头或切断关节的框会被丢掉。豆包的默认模型名会随版本变化，请把 `LLM_MODEL` 设成你账号里已开通的视觉模型或接入点 id。

## 许可证

MIT。MediaPipe 运行时和关键点模型为 Apache-2.0，见 `public/vendor/NOTICE`。
