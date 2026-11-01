# Architecture

Framing Cam is a static Vite + TypeScript app plus two serverless endpoints. The phone does the time-critical work. The network is optional and only refines a crop.

## Pipeline

```text
camera frame
  -> 960px ImageBitmap (main thread, ~15 fps)
  -> Web Worker: MediaPipe Pose + Face Landmarker
  -> subject (head, eyes, joints), smoothed and tracked
  -> planFrame(): one instruction + one crop rectangle
  -> overlay (brackets, arrow, level line) and optional speech / vibration
  -> when steady ~0.5s and a key exists: one JPEG to /api/frame
  -> shutter (human, or auto once the plan says ready)
  -> JPEG crops at 4:5, 3:4, 9:16
```

`planFrame` in `src/composition/plan.ts` is a pure function. The UI, the worker, and the demo all call it. Tests call it with synthetic subjects and with landmarks read back from a painted PNG.

## On-device vision

`src/vision/worker.ts` loads `@mediapipe/tasks-vision` 0.10.35.

- Pose: `pose_landmarker_lite` float16 (33 landmarks). This is enough to know shoulders, elbows, wrists, hips, knees, and ankles, and to estimate a head if the face model misses.
- Face: `face_landmarker` float16. The worker keeps a handful of points (forehead, chin, eyes, nose, cheeks), not all 478. Hair is not a landmark; the skull top is estimated at about 0.55 of the face-mesh height above the forehead point.
- The wasm files are the ES module build (`vision_wasm_module_internal`). Module workers cannot `importScripts`. The module build assigns `globalThis.ModuleFactory`. MediaPipe clears that factory after creating a task, so the worker imports the loader once, keeps the factory, and restores it before starting the face landmarker. Pose and face therefore get two wasm instances. If the face model fails, pose-only guidance still runs.
- Desktop tries the GPU delegate first, then CPU. iPhone and iPad start on CPU, because Safari's GPU delegate can accept setup and then throw on every frame. A later GPU failure rebuilds both models on CPU. A face with no body still counts as a subject, and the face landmarker runs on any frame where pose finds nobody. Face inference drops to every other frame when it takes longer than 50 ms.
- Frames are copied to `ImageData`. Safari's `ImageBitmap` reports `videoWidth: 0`, and MediaPipe uses that property whenever it exists, so a bitmap is a 0×0 image. The wasm and `.task` files are copied into `public/vendor` and loaded from the page origin.
- Detection starts in a module worker on Chrome. iOS and other Safari browsers start on the main thread: their workers have no `document`, and MediaPipe calls `document.createElement` when `importScripts` is missing (`Can't find variable: document`). The loader shim throws `TypeError` so MediaPipe uses `import()` instead. Safari also gets a real `HTMLCanvasElement` for the GL context, because `OffscreenCanvas` WebGL is missing in some WebKits. If a worker is tried and init fails or times out, pose and face are created again on the main thread. iPhone uses the CPU delegate. Main-thread frames are paced with `requestVideoFrameCallback`. The red banner appears only when both places fail.
- Models and wasm are same-origin (`public/vendor`). They are not fetched from `storage.googleapis.com` at runtime.

The main thread never waits on a backlog. If the worker is busy, the frame is dropped.

## Coordinates

Landmarks are normalized to the camera buffer, origin top-left, y downward. Aspect ratio is always computed in pixels, because a normalized `w/h` is not the photo's aspect unless the buffer is square.

The preview uses `object-fit: cover`. `coverTransform` maps buffer coordinates onto the screen. The front camera is mirrored with CSS; guidance left/right is flipped to match what the holder sees, and the saved selfie is mirrored so it matches the preview. Rear camera output is not mirrored.

The level line comes from motion, not from the shoulders (the subject may lean). `rollFromGravity` uses acceleration including gravity: positive means the right side of the phone is lower. Gamma is the fallback. A phone lying flat does not produce a portrait roll.

## Composition

`src/composition/rank.ts` builds a few dozen candidate rectangles:

- vertical spans for head, chest, waist, mid-thigh, and full length, only where those joints exist
- horizontal placement centered, or toward the opposite side of the gaze so there is looking room
- an analytic crop that puts the eyes on the upper-third line at the ideal head size
- the largest rectangle of the requested aspect (the viewfinder itself)

Each candidate is scored on eye line, headroom, horizontal placement, how large the head is inside the crop, shoulder inclusion, and a penalty when an edge passes through a joint or the neck. Candidates tighter than `MAX_DIGITAL_ZOOM` (1.65× relative to the full aspect frame) are dropped unless nothing legal remains. The winner is what the shutter crops.

This is the GAIC idea — generate crops, rank them — without a GAIC network. Those models are large classification/regression nets trained on aesthetic datasets. Shipping one would dominate download size and still would not know "do not cut the knee". The rule scorer is deterministic and covered by tests. `prepareLlmCrop` is the seam where a future ranker could sit: it must return a rectangle that survives the same geometric checks.

Guidance is separate from the crop. The holder is asked to move until the eyes and the head size already sit well inside the full viewfinder. The crop only cleans up what remains, which keeps resolution. Priority:

1. nobody in frame
2. phone upside down, or the person is much too small / much too close
3. a large tilt
4. the largest remaining error among pan, vertical, distance, and small tilt
5. hold steady, then ready

Prompts are stabilized for a few frames so they do not flicker. Ready and "find the person" switch immediately. Auto-capture fires once when `ready` is true. `ready` already requires the steady detector's 500 ms window of still landmarks (and, when the accelerometer is present and the picture is not rock-steady, low linear acceleration).

## Cloud crop

`VITE_BASE` selects the public path. GitHub Pages sets `/framing-cam/`; Netlify and local dev leave it at `/`. Asset URLs, including wasm and the `.task` models, are joined onto that base.

The client calls `/api/health` only in dev, or when the build was given `VITE_CLOUD=1` (Netlify). The Pages bundle omits the call, so a missing server is not a failed request.

`server/handle.ts` is the shared handler. The Vite dev middleware and `netlify/functions/api.ts` both use it. `resolveLlmTarget` maps `LLM_PROVIDER` to an OpenAI-compatible preset:

- `dashscope` / `qwen` / `qwen-vl` → `https://dashscope.aliyuncs.com/compatible-mode/v1`, model `qwen-vl-max`
- `doubao` / `volcengine` / `ark` → `https://ark.cn-beijing.volces.com/api/v3`, model `doubao-seed-2-1-pro-260628`, with thinking disabled
- `openai`, `openai-compatible`, `anthropic`, or any `LLM_BASE_URL`

`LLM_BASE_URL` and `LLM_MODEL` override the preset. No `LLM_API_KEY` means `/api/health` returns `{ llm: false }` and `/api/frame` refuses the call. The key stays on the server.

The request is one JPEG, long edge 768, plus the landmark summary and the rules box. The prompt asks for JSON: a normalized box, one move, one sentence, a confidence. Invalid JSON, a box that misses the head, a box past the zoom limit, or a box that cuts a joint is discarded. Arrows stay on the local rules so a slow or wrong model cannot yank the holder around. An accepted box only replaces the crop.

## Demo

`src/demo/person.ts` synthesizes the same `Subject` the vision worker would produce. `applyGuidance` moves that subject the way the frame would move if a holder obeyed the current prompt. The unit test runs this loop until the plan is ready. The in-app demo draws that subject and, with `?demo=auto`, runs the same loop.

## iOS and Android constraints

| Constraint | What the app does |
| --- | --- |
| `getUserMedia` needs a secure context | README: localhost, mkcert, or Vercel HTTPS |
| Zoom constraints mainly on iOS 17+ | Not used. Digital crop plus "step closer" |
| `ImageCapture.takePhoto` field of view can differ from the preview | Crop the video frame the coach analyzed. Request the largest stream the browser will give |
| `playsinline` | Set, or iOS plays the camera fullscreen |
| Module worker + MediaPipe wasm | ES module wasm build; factory restored for the second model |
| No vibration on iOS | `navigator.vibrate` is feature-detected |
| Motion permission is a user gesture | Requested on the same tap as the camera |

## What is intentionally absent

Filters, skin smoothing, relighting, a social feed, and any instruction aimed at the person being photographed. The product being referenced asks a friend to frame you. This app does that job and stops.

---

# 架构（中文）

构图相机是一个 Vite + TypeScript 静态应用，加上两个无服务器接口。要紧的计算在手机上。网络是可选的，只用来微调裁切。

## 流水线

```text
相机帧
  -> 主线程压到长边约 960 像素（大约 15 帧/秒）
  -> Web Worker：MediaPipe 姿势 + 人脸关键点
  -> 主体（头、眼睛、关节），平滑并跟踪
  -> planFrame()：一条指令 + 一个裁切矩形
  -> 叠层（取景框、箭头、水平线），以及可选的语音和振动
  -> 稳定约 0.5 秒且配置了密钥时：一张 JPEG 到 /api/frame
  -> 快门（人按，或计划变为 ready 时自动）
  -> 输出 4:5、3:4、9:16 的 JPEG
```

`src/composition/plan.ts` 里的 `planFrame` 是纯函数。界面、Worker 和演示都调用它。测试用合成的主体，也用从绘制的 PNG 里读回来的关键点调用它。

## 端上视觉

`src/vision/worker.ts` 使用 `@mediapipe/tasks-vision` 0.10.35。

- 姿势：`pose_landmarker_lite` float16（33 个点）。足以得到肩、肘、腕、髋、膝、踝；人脸模型失败时也可以估出一个头。
- 人脸：`face_landmarker` float16。Worker 只保留额头、下巴、眼、鼻、脸颊，不传全部 478 个点。头发不是关键点；颅顶按脸网格高度的大约 0.55 倍，加在额头点之上。
- wasm 用的是 ES module 构建（`vision_wasm_module_internal`）。Module worker 不能 `importScripts`。这个构建会把 `ModuleFactory` 挂到 `globalThis`。MediaPipe 创建完一个任务后会清掉这个工厂，因此 Worker 先导入一次加载器，留下工厂，在启动人脸模型前再放回去。姿势和人脸于是各有一份 wasm 实例。人脸失败时，仍可用姿势做引导。
- 桌面端先试 GPU，失败再用 CPU。iPhone 和 iPad 一开始就用 CPU，因为 Safari 的 GPU 委托可能创建成功、随后每一帧都抛错。运行中如果 GPU 失败，会把两个模型都重建到 CPU。只有脸、没有身体的特写也算一个人；姿势没找到人的那一帧会跑人脸。人脸推理超过 50 毫秒时改为隔帧。
- 画面先画成 `ImageData`。Safari 的 `ImageBitmap.videoWidth` 是 0，而 MediaPipe 只要这个属性存在就用它，于是把整帧当成 0×0。wasm 和 `.task` 复制到 `public/vendor`，只从页面自己的域名加载。
- Chrome 先在 module worker 里识别。iOS 和其他 Safari 直接在主线程识别：这些 worker 没有 `document`，而 MediaPipe 在没有 `importScripts` 时会调用 `document.createElement`（`Can't find variable: document`）。加载器垫片会抛 `TypeError`，让 MediaPipe 改走 `import()`。Safari 的 GL 画布用真正的 `HTMLCanvasElement`，因为有的 WebKit 里 `OffscreenCanvas` 没有 WebGL。如果仍然先试了 worker 并且初始化失败或超时，姿势和人脸会再在主线程创建。iPhone 用 CPU，主线程用 `requestVideoFrameCallback` 限帧。两边都失败时才显示红色的「识别模型加载失败」。
- 模型和 wasm 都在同一域名（`public/vendor`），运行时不向 `storage.googleapis.com` 请求。

主线程不堆积帧。Worker 正忙时，这一帧直接丢掉。

## 坐标

关键点相对相机缓冲归一化，原点在左上，y 向下。画幅一定在像素里算，因为归一化的 `w/h` 只有在缓冲是正方形时才等于照片比例。

预览用 `object-fit: cover`。`coverTransform` 把缓冲坐标映到屏幕上。前置摄像头用 CSS 镜像；左右提示会翻转到拿手机的人看到的方向，保存的自拍也会镜像，以便和预览一致。后置摄像头的成片不镜像。

水平线来自运动传感器，不来自肩膀（被拍的人可能自己歪着）。`rollFromGravity` 使用含重力的加速度：正值表示手机右边偏低。没有加速度时退回 gamma。手机平放在桌上时，不算作竖拍的倾斜。

## 构图

`src/composition/rank.ts` 生成几十个候选矩形：

- 按头、胸、腰、大腿中段、全身做纵向跨度；没有相应关节就不生成
- 水平位置居中；视线偏向一侧时，把人放到另一侧，把空留给视线
- 一个解析裁切：眼睛落在上三分线，头的大小接近目标
- 该画幅在画面里能放下的最大矩形（取景框本身）

打分看：眼睛高度、头顶留白、左右位置、头在裁切里的大小、肩膀有没有被裁掉，以及边缘是否切过关节或脖子。比满画幅紧过 `MAX_DIGITAL_ZOOM`（1.65 倍）的候选会被丢掉，除非没有任何合格候选。胜出的矩形就是快门要裁的区域。

这是 GAIC 的思路——生成一批裁切再排序——但没有附带 GAIC 网络。那些模型是在审美数据集上训练的大型打分网络，放进首屏会占掉大部分下载，而且仍然不知道「不要切到膝盖」。规则打分是确定的，并且有测试。`prepareLlmCrop` 是以后替换排序器的接口：它返回的矩形必须通过同一套几何检查。

引导和裁切是分开的。先让拿手机的人把眼睛和头的大小移进取景框里大致正确的位置，裁切只收拾剩余的误差，这样分辨率还在。优先级：

1. 画面里没有人
2. 手机拿倒了，或者人小得太多 / 近得太多
3. 倾斜很大
4. 平移、上下、距离、小倾斜里最大的那一项
5. 保持稳定，然后可以拍了

提示会稳住几帧，避免闪烁。「可以拍了」和「把人物放进画面」会立刻切换。自动拍摄在 `ready` 为真时触发一次。`ready` 本身就要求稳定检测器看到大约 500 毫秒的静止关键点（如果有加速度计，并且画面并不是非常稳，还要求线性加速度低）。

## 云端裁切

`VITE_BASE` 决定公开路径。GitHub Pages 设为 `/framing-cam/`；Netlify 和本地开发保持 `/`。资源地址，包括 wasm 和 `.task` 模型，都接在这个 base 后面。

客户端只在开发模式，或构建时带了 `VITE_CLOUD=1`（Netlify）时，才请求 `/api/health`。Pages 的包里没有这次请求，所以没有服务器也不会出现失败请求。

`server/handle.ts` 是共用处理函数。Vite 开发服务器和 `netlify/functions/api.ts` 都用它。`resolveLlmTarget` 把 `LLM_PROVIDER` 映到兼容 OpenAI 的预设：

- `dashscope` / `qwen` / `qwen-vl` → `https://dashscope.aliyuncs.com/compatible-mode/v1`，模型 `qwen-vl-max`
- `doubao` / `volcengine` / `ark` → `https://ark.cn-beijing.volces.com/api/v3`，模型 `doubao-seed-2-1-pro-260628`，并关闭深度思考
- `openai`、`openai-compatible`、`anthropic`，或任意 `LLM_BASE_URL`

`LLM_BASE_URL` 和 `LLM_MODEL` 会覆盖预设。没有 `LLM_API_KEY` 时，`/api/health` 返回 `{ llm: false }`，`/api/frame` 拒绝调用。密钥只留在服务端。

请求体是一张长边 768 的 JPEG，加上关键点摘要和规则框。提示词要求只返回 JSON：一个归一化的框、一个动作、一句话、一个置信度。供应商由上面的预设决定。JSON 无效、框没有包住头、超过变焦限度、或切断关节，都会丢掉。箭头始终由本地规则决定，慢的或错的模型不能把拿手机的人拽来拽去。通过检查的框只替换裁切。

## 演示

`src/demo/person.ts` 合成与视觉 Worker 相同结构的 `Subject`。`applyGuidance` 按「如果拿手机的人照做了，画面会怎么变」来移动这个人。单元测试把这个循环跑到计划变为 ready。页面里的演示画出这个人；`?demo=auto` 跑同一个循环。

## iOS 与 Android 的限制

| 限制 | 应用里的做法 |
| --- | --- |
| `getUserMedia` 需要安全上下文 | 说明文档：localhost、mkcert，或 Vercel 的 HTTPS |
| 变焦约束主要在 iOS 17+ | 不用。数字裁切，加上「靠近一点」 |
| `ImageCapture.takePhoto` 的视野可能和预览不同 | 裁引导分析过的那一帧视频。并请求浏览器愿意给的最大流 |
| `playsinline` | 已设置，避免 iOS 把相机全屏播放 |
| Module worker 与 MediaPipe wasm | 使用 ES module 版 wasm；第二个模型前放回工厂函数 |
| iOS 没有振动 | 先检测 `navigator.vibrate` |
| 动作权限必须在用户手势里请求 | 和打开相机的同一次点击里请求 |

## 有意不做的事

滤镜、磨皮、补光、信息流，以及任何说给被拍的人听的摆姿指令。被参考的那类产品，是让朋友帮你取景。这个应用做完这件事就停。
