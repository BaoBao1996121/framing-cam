# Framing Cam

A portrait camera that runs in the mobile browser. No install. Someone else holds the phone; the page tells them how to move — left, right, up, down, closer, back, or level the horizon — until the person in front is in a strong frame. The shutter is still a human decision. Auto-capture is optional, and it only fires after the frame has been aligned and steady for about half a second.

The final photo is a real crop of the camera frame, not an upscale. If the person is too small to crop cleanly, the page asks the holder to step closer.

**Inspired by the idea of real-time composition guidance in [Doka Cam](https://www.yindoka.com/official/).** This is an independent open-source implementation. It is not affiliated with Doka or its makers, and it does not copy their interface, models, or assets.

[中文说明](#中文)

## Try it on a phone

1. Deploy it (Vercel is the easiest path that also enables the optional cloud crop), or run the HTTPS dev server below.
2. Open the URL in **iOS Safari** or **Android Chrome**. The camera only works on HTTPS, or on `localhost`.
3. Tap **打开相机**, allow the camera, and — on iPhone — allow motion access so the horizon can be leveled.
4. Hand the phone to a friend. Use the rear camera. They follow the arrow and the short prompt.
5. When it says **可以拍了**, tap the shutter, or leave **自动** on and hold still.
6. Save the current frame, or save all three: **4:5**, **3:4**, and **9:16**. On iPhone you can also long-press the photo.

**先看演示** runs the same coach against a drawn figure, so you can try the guidance without a camera. `?demo=auto` plays that loop by itself. `?lang=en` starts in English. The default language is Simplified Chinese.

## How it works

On the phone, MediaPipe Pose and Face Landmarker run in a Web Worker at about 15 fps. From the landmarks the page builds a portrait plan:

- eyes near the upper third
- a little room above the hair
- the frame does not cut knees, elbows, wrists, ankles, or the neck
- looking room when the nose points to one side
- the phone held level, using the motion sensors

Large errors become a single instruction for the person holding the phone. Small errors are finished by a digital crop. The crop is not allowed to throw away so many pixels that the photo goes soft; past that limit the instruction is **靠近一点**.

When the phone is steady, and only if you configured an API key, one small JPEG is sent to a serverless function. A vision model may return a tighter crop box. The box is kept only if it still contains the head, matches the aspect ratio, and does not cut a joint. With no key, or if the call fails, nothing leaves the phone.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local development

```bash
npm install
npm test
npm run dev          # http://localhost:5173 — camera works on this computer
npm run dev:https    # https on your LAN, self-signed certificate
```

`npm install` copies the MediaPipe wasm runtime into `public/vendor/wasm`. The pose and face models are already in `public/vendor/models`, so the phone does not have to download them from Google at runtime.

### Phone on the same Wi-Fi

Self-signed HTTPS (`npm run dev:https`) is enough for many Android phones: open `https://<your-lan-ip>:5173` and continue past the warning.

iOS Safari is stricter. A certificate you trust locally is more reliable:

```bash
brew install mkcert   # or your platform's mkcert package
mkcert -install
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 192.168.1.20
npm run dev:mkcert
```

Use your computer's LAN address in the `mkcert` command. Install the mkcert root CA on the iPhone (mkcert's docs describe this), then open `https://192.168.1.20:5173`.

Desktop `http://localhost:5173` is a secure context, so the camera works there without HTTPS. Another computer on the LAN using plain `http://192.168.x.x` is not a secure context, and `getUserMedia` will fail.

The dev server also exposes `GET /api/health` and `POST /api/frame`. Copy `.env.example` to `.env` if you want the cloud crop locally. Leave `LLM_API_KEY` empty to stay rules-only.

## Deploy

### Vercel

The repo is a Vite app plus `api/health.ts` and `api/frame.ts`.

1. Import the GitHub repository in Vercel. Framework preset: Vite. Output: `dist`.
2. Set environment variables (server only, never `VITE_`):

| Variable | Purpose |
| --- | --- |
| `LLM_API_KEY` | Secret for the vision model. Empty disables cloud refine. |
| `LLM_PROVIDER` | `openai` (default), `openai-compatible`, or `anthropic` |
| `LLM_BASE_URL` | Optional. OpenAI-compatible proxy, for example `https://openrouter.ai/api/v1` |
| `LLM_MODEL` | Optional. Default `gpt-4o-mini`, or `claude-3-5-haiku-latest` for Anthropic |

`gpt-4o-mini` still accepts images on the OpenAI API; OpenAI plans to remove it on 14 January 2027 and points people to `gpt-6-luna`. Set `LLM_MODEL` when you want a different model. Newer GPT models are called with `reasoning_effort: none` so the reply stays a short JSON crop.

3. Deploy. Open the HTTPS URL on a phone.

### GitHub Pages

Pages can host the static app only. Cloud refine stays off, and the on-device coach still works.

`base` is `./`, so the build works at a project-site path such as `https://<user>.github.io/framing-cam/`.

```bash
npm ci
npm run build
# publish the dist/ directory with your Pages action or branch
```

Do not put an API key in the client. There is nowhere safe to put one on Pages.

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
- Pose and face run on the GPU when they can, and on the CPU otherwise. The first load reads a few megabytes of wasm and models from the same origin.
- The aesthetic ranker is a portrait rule scorer in the spirit of learned crop rankers such as GAIC, not a shipped neural ranking model. A network that large is a poor fit for a first paint on a phone, and the rules are testable.
- One primary subject. Tap another face to switch. The coach does not direct the person being photographed, only the person holding the phone.
- No filters, relighting, or beauty retouch. That is deliberate.
- A tilted or sideways video buffer on a particular Android build can misalign the overlay. The crop and the overlay use the same buffer, so they still match each other.
- Cloud refine sees a 768px JPEG of one steady frame. It can be wrong; geometry checks drop bad boxes.

## License

MIT. MediaPipe runtime and landmarker models are Apache-2.0, see `public/vendor/NOTICE`.

---

# 中文

构图相机是一个跑在手机浏览器里的人像相机，不用安装。朋友拿着手机，页面向他提示怎么移动：左右、抬高放低、靠近后退、把地平线摆正，直到被拍的人处在合适的构图里。快门默认由人来按。也可以打开自动拍摄：构图对准并且稳定大约半秒后才拍。

成片是从相机画面里裁出来的，不会把一小块放大到发糊。人如果太小，页面会请拿手机的人走近。

**产品思路受 [Doka 相机](https://www.yindoka.com/official/) 的实时构图引导启发。** 这是独立的开源实现，与 Doka 及其开发者没有关联，也不复制对方的界面、模型或素材。

## 在手机上试用

1. 部署到 Vercel（这样可选的云端裁切也能用），或者按下面的方式在局域网开 HTTPS。
2. 用 **iOS Safari** 或 **Android Chrome** 打开。相机只在 HTTPS 或 `localhost` 上可用。
3. 点 **打开相机**。允许摄像头；在 iPhone 上再允许动作与方向，才能校正地平线。
4. 把手机交给朋友，用后置摄像头。对方看箭头和那一句短提示。
5. 出现 **可以拍了** 就按快门。开着 **自动** 时，稳住约半秒会自己拍。
6. 保存当前画幅，或一次保存 **4:5**、**3:4**、**9:16**。iPhone 上也可以长按照片保存。

**先看演示** 用一个画出来的人走同一套引导，没有相机也能看提示。地址加上 `?demo=auto` 会自动把人物走到可拍的位置。`?lang=en` 使用英文。默认语言是简体中文。

## 它怎么工作

手机里，MediaPipe 的姿势和人脸关键点在 Web Worker 中大约每秒 15 帧运行。页面据此做一张人像构图：

- 眼睛靠近上三分线
- 头顶留一点空间
- 不在膝盖、手肘、手腕、脚踝或脖子处下刀
- 鼻子偏向一侧时，给视线留空
- 用运动传感器把手机摆平

偏差大的时候，只给拿手机的人一条指令。剩下的小偏差用数字裁切收干净。裁切不允许丢掉太多像素；超过限度就改口说 **靠近一点**。

只有配置了 API 密钥、并且手机稳定时，才会把一帧缩小的 JPEG 发给无服务器函数。视觉模型可以返回一个更紧的裁切框。这个框必须仍然包住头、符合画幅、而且不切断关节，才会被采用。没有密钥或请求失败时，画面不会离开手机。

细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 本地开发

```bash
npm install
npm test
npm run dev          # http://localhost:5173 ，在这台电脑上可以开相机
npm run dev:https    # 局域网 HTTPS，自签证书
```

`npm install` 会把 MediaPipe 的 wasm 复制到 `public/vendor/wasm`。姿势和人脸模型已经放在 `public/vendor/models`，手机运行时不必再去 Google 下载。

### 同一 Wi-Fi 下的手机

很多 Android 手机用 `npm run dev:https` 即可：打开 `https://<电脑局域网 IP>:5173`，忽略证书警告。

iOS Safari 对自签证书很严。更稳妥的是本地信任的证书：

```bash
brew install mkcert   # 或其他平台的 mkcert
mkcert -install
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 192.168.1.20
npm run dev:mkcert
```

把命令里的地址换成你电脑的局域网 IP。按 mkcert 的说明把根证书装到 iPhone 上，然后打开 `https://192.168.1.20:5173`。

电脑上的 `http://localhost:5173` 属于安全上下文，不装 HTTPS 也能开相机。局域网里用 `http://192.168.x.x` 则不是安全上下文，`getUserMedia` 会失败。

开发服务器同时提供 `GET /api/health` 和 `POST /api/frame`。需要云端裁切时，把 `.env.example` 复制为 `.env`。`LLM_API_KEY` 留空就只使用本机构图。

## 部署

### Vercel

这是一个 Vite 应用，外加 `api/health.ts` 和 `api/frame.ts`。

1. 在 Vercel 导入本仓库。框架选 Vite，输出目录 `dist`。
2. 只在服务端配置环境变量，不要加 `VITE_` 前缀：

| 变量 | 作用 |
| --- | --- |
| `LLM_API_KEY` | 视觉模型的密钥。留空则关闭云端微调 |
| `LLM_PROVIDER` | `openai`（默认）、`openai-compatible` 或 `anthropic` |
| `LLM_BASE_URL` | 可选。兼容 OpenAI 的代理，例如 `https://openrouter.ai/api/v1` |
| `LLM_MODEL` | 可选。OpenAI 默认 `gpt-4o-mini`，Anthropic 默认 `claude-3-5-haiku-latest` |

`gpt-4o-mini` 目前仍可在 OpenAI API 中看图；OpenAI 计划于 2027 年 1 月 14 日下线它，并建议改用 `gpt-6-luna`。想换模型就设置 `LLM_MODEL`。较新的 GPT 会带上 `reasoning_effort: none`，避免长篇推理，只返回一段裁切 JSON。

3. 部署后，用手机打开那个 HTTPS 地址。

### GitHub Pages

Pages 只能托管静态页面。云端微调不可用，手机上的构图引导仍然可用。

构建的 `base` 是 `./`，因此可以放在 `https://<user>.github.io/framing-cam/` 这样的项目站路径下。

```bash
npm ci
npm run build
# 用 Pages 动作或分支发布 dist/
```

不要把 API 密钥放进前端。Pages 上没有可以安全存放密钥的地方。

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
- 姿势和人脸能用 GPU 就用 GPU，否则用 CPU。第一次打开会从同一域名读取数兆的 wasm 和模型。
- 审美排序是一套人像规则打分，思路接近 GAIC 这类「给裁切打分再排序」的方法，但没有附带一个神经网络排序模型。那样的模型太大，不适合手机上的第一次打开，而这套规则可以被测试。
- 默认只跟一个主体。点另一张脸可以切换。引导只对拿手机的人说话，不指挥被拍的人摆姿势。
- 没有滤镜、补光或美颜。这是有意为之。
- 个别 Android 机型的视频缓冲方向若和预览不一致，叠层可能对不齐。裁切和叠层使用同一块缓冲，因此它们彼此仍然一致。
- 云端微调只看到稳定时的一张 768 像素 JPEG。它可能判断错；几何检查会丢掉不合格的框。

## 许可证

MIT。MediaPipe 运行时和关键点模型为 Apache-2.0，见 `public/vendor/NOTICE`。
