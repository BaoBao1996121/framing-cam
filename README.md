# Framing Cam

A portrait camera that runs in the mobile browser. No install. Someone else holds the phone; the page tells them how to move — left, right, up, down, closer, back, or level the horizon — until the person in front is in a strong frame. The shutter is still a human decision. Auto-capture is optional, and it only fires after the frame has been aligned and steady for about half a second.

The final photo is a real crop of the camera frame, not an upscale. If the person is too small to crop cleanly, the page asks the holder to step closer.

**Inspired by the idea of real-time composition guidance in [Doka Cam](https://www.yindoka.com/official/).** This is an independent open-source implementation. It is not affiliated with Doka or its makers, and it does not copy their interface, models, or assets.

[中文说明](#中文)

## Try it on a phone

The static site is [https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/). Open it in **iOS Safari** or **Android Chrome**. The published site has no server: cloud refine stays off, and framing stays on the phone.

1. Tap **打开相机**. Allow the camera, and on iPhone allow motion access so the horizon can be leveled.
2. Hand the phone to a friend. Use the rear camera. They follow the arrow and the short prompt.
3. When it says **可以拍了**, tap the shutter, or leave **自动** on and hold still.
4. Save the current frame, or save all three: **4:5**, **3:4**, and **9:16**. On iPhone you can also long-press the photo.

**先看演示** runs the same coach against a drawn figure, so you can try the guidance without a camera. `?demo=auto` plays that loop by itself. `?lang=en` starts in English. The default language is Simplified Chinese.

## How it works

On the phone, MediaPipe Pose and Face Landmarker run in a Web Worker at about 15 fps. From the landmarks the page builds a portrait plan:

- eyes near the upper third
- a little room above the hair
- the frame does not cut knees, elbows, wrists, ankles, or the neck
- looking room when the nose points to one side
- the phone held level, using the motion sensors

Large errors become a single instruction for the person holding the phone. Small errors are finished by a digital crop. The crop is not allowed to throw away so many pixels that the photo goes soft; past that limit the instruction is **靠近一点**.

The GitHub Pages build never calls a server. Framing, the crop, and the shutter all stay on the phone. A local dev server can still offer an optional cloud crop when `LLM_API_KEY` is set; the box is kept only if it contains the head, matches the aspect ratio, and does not cut a joint.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local development

```bash
npm install
npm test
npm run dev          # http://localhost:5173/framing-cam/
npm run dev:https    # https on your LAN, self-signed certificate
```

`npm install` copies the MediaPipe wasm runtime into `public/vendor/wasm`. The pose and face models are already in `public/vendor/models`, so the phone does not have to download them from Google at runtime.

### Phone on the same Wi-Fi

Self-signed HTTPS (`npm run dev:https`) is enough for many Android phones: open `https://<your-lan-ip>:5173/framing-cam/` and continue past the warning.

iOS Safari is stricter. A certificate you trust locally is more reliable:

```bash
brew install mkcert   # or your platform's mkcert package
mkcert -install
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 192.168.1.20
npm run dev:mkcert
```

Use your computer's LAN address in the `mkcert` command. Install the mkcert root CA on the iPhone (mkcert's docs describe this), then open `https://192.168.1.20:5173/framing-cam/`.

Desktop `http://localhost:5173/framing-cam/` is a secure context, so the camera works there without HTTPS. Another computer on the LAN using plain `http://192.168.x.x` is not a secure context, and `getUserMedia` will fail.

The dev server can expose `GET /api/health` and `POST /api/frame`. Copy `.env.example` to `.env` if you want that local cloud crop. The published site does not use it. Leave `LLM_API_KEY` empty to stay rules-only even in dev.

## Deploy

GitHub Pages hosts the site at [https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/).

Pushing `main` runs `.github/workflows/pages.yml`. It builds the Vite app with `base: '/framing-cam/'` and deploys `dist` with `actions/deploy-pages`. In the repository settings, set Pages → Build and deployment → Source to **GitHub Actions**.

The static build does not call `/api`. Cloud refine stays off, with no failed request. Pose and face models and the wasm runtime are copied into `dist/vendor` and requested under `/framing-cam/vendor/...`.

There is no API key on the client. Optional cloud refine exists only on the local dev server.

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
- The GitHub Pages site does not upload frames. Cloud refine exists only on the local dev server, and a bad box is dropped if it misses the head or cuts a joint.

## License

MIT. MediaPipe runtime and landmarker models are Apache-2.0, see `public/vendor/NOTICE`.

---

# 中文

构图相机是一个跑在手机浏览器里的人像相机，不用安装。朋友拿着手机，页面向他提示怎么移动：左右、抬高放低、靠近后退、把地平线摆正，直到被拍的人处在合适的构图里。快门默认由人来按。也可以打开自动拍摄：构图对准并且稳定大约半秒后才拍。

成片是从相机画面里裁出来的，不会把一小块放大到发糊。人如果太小，页面会请拿手机的人走近。

**产品思路受 [Doka 相机](https://www.yindoka.com/official/) 的实时构图引导启发。** 这是独立的开源实现，与 Doka 及其开发者没有关联，也不复制对方的界面、模型或素材。

## 在手机上试用

静态站点：[https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/)。用 **iOS Safari** 或 **Android Chrome** 打开。发布的页面没有服务器：云端微调保持关闭，构图在手机上完成。

1. 点 **打开相机**。允许摄像头；在 iPhone 上再允许动作与方向，才能校正地平线。
2. 把手机交给朋友，用后置摄像头。对方看箭头和那一句短提示。
3. 出现 **可以拍了** 就按快门。开着 **自动** 时，稳住约半秒会自己拍。
4. 保存当前画幅，或一次保存 **4:5**、**3:4**、**9:16**。iPhone 上也可以长按照片保存。

**先看演示** 用一个画出来的人走同一套引导，没有相机也能看提示。地址加上 `?demo=auto` 会自动把人物走到可拍的位置。`?lang=en` 使用英文。默认语言是简体中文。

## 它怎么工作

手机里，MediaPipe 的姿势和人脸关键点在 Web Worker 中大约每秒 15 帧运行。页面据此做一张人像构图：

- 眼睛靠近上三分线
- 头顶留一点空间
- 不在膝盖、手肘、手腕、脚踝或脖子处下刀
- 鼻子偏向一侧时，给视线留空
- 用运动传感器把手机摆平

偏差大的时候，只给拿手机的人一条指令。剩下的小偏差用数字裁切收干净。裁切不允许丢掉太多像素；超过限度就改口说 **靠近一点**。

GitHub Pages 上的版本不会请求服务器。构图、裁切和快门都在手机里完成。本地开发服务器在设置了 `LLM_API_KEY` 时仍可以做可选的云端裁切；返回的框必须包住头、符合画幅、而且不切断关节，才会被采用。

细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 本地开发

```bash
npm install
npm test
npm run dev          # http://localhost:5173/framing-cam/
npm run dev:https    # 局域网 HTTPS，自签证书
```

`npm install` 会把 MediaPipe 的 wasm 复制到 `public/vendor/wasm`。姿势和人脸模型已经放在 `public/vendor/models`，手机运行时不必再去 Google 下载。

### 同一 Wi-Fi 下的手机

很多 Android 手机用 `npm run dev:https` 即可：打开 `https://<电脑局域网 IP>:5173/framing-cam/`，忽略证书警告。

iOS Safari 对自签证书很严。更稳妥的是本地信任的证书：

```bash
brew install mkcert   # 或其他平台的 mkcert
mkcert -install
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 192.168.1.20
npm run dev:mkcert
```

把命令里的地址换成你电脑的局域网 IP。按 mkcert 的说明把根证书装到 iPhone 上，然后打开 `https://192.168.1.20:5173/framing-cam/`。

电脑上的 `http://localhost:5173/framing-cam/` 属于安全上下文，不装 HTTPS 也能开相机。局域网里用 `http://192.168.x.x` 则不是安全上下文，`getUserMedia` 会失败。

开发服务器可以提供 `GET /api/health` 和 `POST /api/frame`。只想在本地试云端裁切时，把 `.env.example` 复制为 `.env`。发布的站点不会用到它。`LLM_API_KEY` 留空时，本地也只用本机构图。

## 部署

GitHub Pages 地址：[https://baobao1996121.github.io/framing-cam/](https://baobao1996121.github.io/framing-cam/)。

推送到 `main` 会运行 `.github/workflows/pages.yml`。它用 `base: '/framing-cam/'` 构建 Vite 应用，再用 `actions/deploy-pages` 发布 `dist`。仓库设置里把 Pages → Build and deployment → Source 选成 **GitHub Actions**。

静态构建不会请求 `/api`。云端微调保持关闭，也不会出现失败请求。姿势、人脸模型和 wasm 会复制进 `dist/vendor`，并从 `/framing-cam/vendor/...` 加载。

前端没有 API 密钥。可选的云端裁切只存在于本地开发服务器。

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
- GitHub Pages 上的站点不会上传画面。云端微调只在本地开发服务器里，不合格的框（没包住头，或切断关节）会被丢掉。

## 许可证

MIT。MediaPipe 运行时和关键点模型为 Apache-2.0，见 `public/vendor/NOTICE`。
