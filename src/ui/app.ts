import { attachCamera, grabInferenceBitmap, stopStream, type Facing } from "../camera/stream";
import { ASPECT_IDS, type AspectId, type FramePlan, type LlmSuggestion, type Subject } from "../composition/types";
import { planFrame, stabilizeGuidance, type GuidanceMemory } from "../composition/plan";
import { assignIds, detectSubjects, selectSubject, smoothSubject, type TrackPoint } from "../composition/subject";
import { AutoShutter, SteadyDetector } from "../composition/steady";
import { cloudAvailable, requestCloudCrop } from "../cloud/client";
import { applyGuidance, DEMO_HEIGHT, DEMO_START, DEMO_WIDTH, subjectFromDemo, type DemoState } from "../demo/person";
import { drawDemo } from "../demo/draw";
import { copyFor, readLocale, storeLocale, type LocaleId } from "../i18n";
import type { Copy } from "../i18n/en";
import { MotionLevel } from "../sensors/listen";
import { canvasFromVideo, canvasToJpeg, downloadBlob, pulse, renderCrop, shutterClick, snapshotDataUrl, speakPrompt, unlockAudio } from "./capture";
import { zipStore } from "../export/zip";
import { coverTransform, screenToImage } from "../composition/geometry";
import { drawOverlay } from "./overlay";
import { vendorUrl, VisionClient } from "../vision/client";

type Mode = "camera" | "demo";
type ScreenName = "gate" | "live" | "review";

type Shot = {
  source: HTMLCanvasElement;
  width: number;
  height: number;
  subject: Subject | null;
  roll: number | null;
  llm: LlmSuggestion | null;
  mirror: boolean;
  aspect: AspectId;
};

export function mountApp(): void {
  new CameraApp().start();
}

class CameraApp {
  private readonly gate = must<HTMLElement>("gate");
  private readonly live = must<HTMLElement>("live");
  private readonly review = must<HTMLElement>("review");
  private readonly video = must<HTMLVideoElement>("video");
  private readonly demoCanvas = must<HTMLCanvasElement>("demo");
  private readonly overlay = must<HTMLCanvasElement>("overlay");
  private readonly overlayCtx = this.overlay.getContext("2d");
  private readonly prompt = must<HTMLElement>("prompt");
  private readonly hint = must<HTMLElement>("hint");
  private readonly toast = must<HTMLElement>("toast");
  private readonly shutterButton = must<HTMLButtonElement>("shutter");
  private readonly about = must<HTMLDialogElement>("about");

  private copy: Copy = copyFor("zh-CN");
  private locale: LocaleId = "zh-CN";
  private aspect: AspectId = "4:5";
  private facing: Facing = "environment";
  private mode: Mode = "camera";
  private screen: ScreenName = "gate";
  private auto = true;
  private voice = false;
  private cloudWanted = true;
  private cloudOk = false;
  private demoAuto = false;
  private running = false;
  private capturing = false;
  private raf = 0;
  private lastGrab = 0;
  private lastDemo = 0;
  private rawGuidance: FramePlan["guidance"] = "searching";
  private guidanceMemory: GuidanceMemory | null = null;
  private spokenCode = "";
  private wasReady = false;
  private stream: MediaStream | null = null;
  private vision: VisionClient | null = null;
  private visionBoot: Promise<void> | null = null;
  private motion = new MotionLevel();
  private steady = new SteadyDetector();
  private autoShutter = new AutoShutter();
  private subjects: Subject[] = [];
  private previousSubjects: Subject[] = [];
  private tracks: TrackPoint[] = [];
  private ids = { n: 0 };
  private selectedId: string | null = null;
  private demo: DemoState = { ...DEMO_START };
  private llm: LlmSuggestion | null = null;
  private llmAnchor: { x: number; y: number } | null = null;
  private lastCloud = 0;
  private cloudFlight = false;
  private shot: Shot | null = null;
  private reviewUrl = "";

  start(): void {
    this.locale = readLocale();
    this.applyCopy();
    this.bind();
    void cloudAvailable().then((ok) => {
      this.cloudOk = ok;
      this.applyToggles();
    });
    const params = new URLSearchParams(location.search);
    if (params.get("vision") === "1") {
      void this.bootVision()
        .then(() => {
          document.body.dataset.vision = "ready";
          document.body.dataset.visionFace = this.vision?.faceReady ? "yes" : "no";
          document.body.dataset.visionFaceError = this.vision?.faceError ?? "";
        })
        .catch((error: unknown) => {
          document.body.dataset.vision = "error";
          document.body.dataset.visionError = error instanceof Error ? error.message : String(error);
        });
    }
    const demo = params.get("demo");
    if (demo === "1" || demo === "auto") this.openDemo(demo === "auto");
  }

  private bind(): void {
    must<HTMLButtonElement>("open-camera").addEventListener("click", () => void this.openCamera());
    must<HTMLButtonElement>("open-demo").addEventListener("click", () => this.openDemo(false));
    must<HTMLButtonElement>("lang").addEventListener("click", () => {
      this.locale = this.locale === "zh-CN" ? "en" : "zh-CN";
      storeLocale(this.locale);
      this.applyCopy();
    });
    must<HTMLButtonElement>("open-about").addEventListener("click", () => this.about.showModal());
    must<HTMLButtonElement>("about-close").addEventListener("click", () => this.about.close());
    must<HTMLButtonElement>("flip").addEventListener("click", () => void this.flip());
    must<HTMLButtonElement>("voice").addEventListener("click", () => {
      this.voice = !this.voice;
      unlockAudio();
      this.applyToggles();
    });
    must<HTMLButtonElement>("cloud").addEventListener("click", () => {
      if (!this.cloudOk) return;
      this.cloudWanted = !this.cloudWanted;
      if (!this.cloudWanted) this.llm = null;
      this.applyToggles();
    });
    must<HTMLButtonElement>("auto").addEventListener("click", () => {
      this.auto = !this.auto;
      this.autoShutter = new AutoShutter();
      this.applyToggles();
    });
    this.shutterButton.addEventListener("click", () => this.capture());
    must<HTMLButtonElement>("retake").addEventListener("click", () => this.show("live"));
    must<HTMLButtonElement>("save").addEventListener("click", () => void this.save(false));
    must<HTMLButtonElement>("save-all").addEventListener("click", () => void this.save(true));
    this.live.addEventListener("pointerdown", (event) => this.pickSubject(event));
    window.addEventListener("resize", () => this.resize());
    this.buildPad();
  }

  private applyCopy(): void {
    this.copy = copyFor(this.locale);
    document.documentElement.lang = this.locale;
    document.title = this.locale === "en" ? "Framing Cam" : "构图相机";
    text("kicker", this.copy.kicker);
    text("title", this.copy.title);
    text("lede", this.copy.lede);
    text("privacy", this.copy.privacy);
    text("open-camera", this.copy.openCamera);
    text("open-demo", this.copy.tryDemo);
    text("lang", this.locale === "zh-CN" ? "EN" : "中文");
    text("open-about", this.copy.about);
    text("about-credit", this.copy.credit);
    text("about-how", this.copy.how);
    text("about-close", this.copy.close);
    text("flip", this.copy.flip);
    text("shutter-label", this.copy.shutter);
    text("badge", this.copy.demoBadge);
    text("save-hint", this.copy.longPress);
    text("retake", this.copy.retake);
    text("save", this.copy.save);
    text("save-all", this.copy.saveAll);
    const steps = must<HTMLElement>("steps");
    steps.replaceChildren();
    this.copy.steps.forEach((step, index) => {
      const item = document.createElement("li");
      const mark = document.createElement("span");
      mark.textContent = String(index + 1);
      item.append(mark, document.createTextNode(step));
      steps.append(item);
    });
    this.renderAspectGroup(must("aspects"), (aspect) => {
      this.aspect = aspect;
      this.renderAspectGroup(must("aspects"), this.aspectHandler);
      this.paintReview();
    });
    this.buildPad();
    this.applyToggles();
    if (this.shot) this.paintReview();
  }

  private aspectHandler = (aspect: AspectId): void => {
    this.aspect = aspect;
    this.renderAspectGroup(must("aspects"), this.aspectHandler);
    this.paintReview();
  };

  private renderAspectGroup(container: HTMLElement, onPick: (aspect: AspectId) => void): void {
    container.replaceChildren();
    container.setAttribute("aria-label", this.copy.ratios);
    for (const aspect of ASPECT_IDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = aspect;
      button.setAttribute("aria-pressed", String(aspect === this.aspect));
      button.addEventListener("click", () => onPick(aspect));
      container.append(button);
    }
  }

  private buildPad(): void {
    const pad = must<HTMLElement>("demo-pad");
    const items: { label: string; nudge: () => void }[] = [
      { label: this.copy.padLeft, nudge: () => (this.demo.eyeX -= 0.03) },
      { label: this.copy.padRight, nudge: () => (this.demo.eyeX += 0.03) },
      { label: this.copy.padUp, nudge: () => (this.demo.eyeY -= 0.03) },
      { label: this.copy.padDown, nudge: () => (this.demo.eyeY += 0.03) },
      { label: this.copy.padIn, nudge: () => (this.demo.headH *= 1.08) },
      { label: this.copy.padOut, nudge: () => (this.demo.headH *= 0.92) },
      { label: this.copy.padTilt, nudge: () => (this.demo.roll = this.demo.roll > 10 ? -8 : this.demo.roll + 3) },
      {
        label: this.demoAuto ? this.copy.demoStop : this.copy.demoPlay,
        nudge: () => {
          this.demoAuto = !this.demoAuto;
          this.buildPad();
        },
      },
    ];
    pad.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        this.demoAuto = item.label === this.copy.demoPlay ? true : item.label === this.copy.demoStop ? false : this.demoAuto;
        if (item.label === this.copy.demoPlay || item.label === this.copy.demoStop) {
          this.demoAuto = item.label === this.copy.demoPlay;
          this.buildPad();
          return;
        }
        item.nudge();
        this.clampDemo();
      });
      pad.append(button);
    }
  }

  private applyToggles(): void {
    press("voice", this.voice, this.copy.voice);
    press("auto", this.auto, this.copy.auto);
    const cloud = must<HTMLButtonElement>("cloud");
    cloud.disabled = !this.cloudOk;
    cloud.setAttribute("aria-pressed", String(this.cloudOk && this.cloudWanted));
    cloud.textContent = this.copy.cloud;
    cloud.title = this.cloudOk ? this.copy.cloud : this.copy.cloudOff;
  }

  private async openCamera(): Promise<void> {
    if (!window.isSecureContext) {
      this.showToast(this.copy.insecure);
      return;
    }
    const button = must<HTMLButtonElement>("open-camera");
    button.disabled = true;
    this.showToast(this.copy.loading);
    try {
      await this.motion.request();
      unlockAudio();
      try {
        await this.bootVision();
      } catch {
        this.showToast(this.copy.modelError);
      }
      this.stream = await attachCamera(this.video, this.facing);
      this.mode = "camera";
      this.video.hidden = false;
      this.demoCanvas.hidden = true;
      this.video.classList.toggle("mirror", this.facing === "user");
      must<HTMLElement>("badge").hidden = true;
      must<HTMLElement>("demo-pad").hidden = true;
      must<HTMLButtonElement>("flip").hidden = false;
      this.resetTracking();
      this.show("live");
      this.startLoop();
      this.hideToast();
    } catch {
      this.showToast(this.copy.cameraError);
    } finally {
      button.disabled = false;
    }
  }

  private openDemo(auto: boolean): void {
    stopStream(this.stream);
    this.stream = null;
    this.mode = "demo";
    this.demoAuto = auto;
    this.demo = { ...DEMO_START };
    this.demoCanvas.width = DEMO_WIDTH;
    this.demoCanvas.height = DEMO_HEIGHT;
    this.demoCanvas.hidden = false;
    this.video.hidden = true;
    must<HTMLElement>("badge").hidden = false;
    must<HTMLElement>("demo-pad").hidden = false;
    must<HTMLButtonElement>("flip").hidden = true;
    this.buildPad();
    this.resetTracking();
    this.show("live");
    this.startLoop();
  }

  private async flip(): Promise<void> {
    if (this.mode !== "camera") return;
    this.facing = this.facing === "environment" ? "user" : "environment";
    stopStream(this.stream);
    try {
      this.stream = await attachCamera(this.video, this.facing);
      this.video.classList.toggle("mirror", this.facing === "user");
      this.resetTracking();
    } catch {
      this.showToast(this.copy.cameraError);
    }
  }

  private resetTracking(): void {
    this.subjects = [];
    this.previousSubjects = [];
    this.tracks = [];
    this.selectedId = null;
    this.llm = null;
    this.llmAnchor = null;
    this.steady.reset();
    this.autoShutter = new AutoShutter();
    this.guidanceMemory = null;
    this.wasReady = false;
  }

  private startLoop(): void {
    this.running = true;
    this.lastDemo = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    this.resize();
  }

  private tick = (time: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.screen === "review") return;
    if (this.mode === "demo") {
      const dt = Math.min(0.05, (time - this.lastDemo) / 1000 || 0.016);
      this.lastDemo = time;
      if (this.demoAuto) {
        this.demo = applyGuidance(this.demo, this.rawGuidance, dt);
        this.clampDemo();
      }
      const context = this.demoCanvas.getContext("2d");
      if (context) drawDemo(context, this.demo);
      const subject = subjectFromDemo(this.demo);
      this.subjects = [subject];
      this.steady.pushLandmark(time, subject.eye.x, subject.eye.y);
    } else if (this.video.readyState >= 2 && time - this.lastGrab > 66) {
      this.lastGrab = time;
      void this.sendFrame(time);
    }
    this.steady.pushAccel(time, this.motion.linearG);
    this.render(time);
  };

  private async sendFrame(time: number): Promise<void> {
    if (!this.vision?.ready || this.video.videoWidth < 2) return;
    try {
      const bitmap = await grabInferenceBitmap(this.video);
      this.vision.send(bitmap, time);
    } catch {
      /* The next frame will try again. */
    }
  }

  private onPerception(perception: { faces: Parameters<typeof detectSubjects>[0]; poses: Parameters<typeof detectSubjects>[1] }): void {
    const found = detectSubjects(perception.faces, perception.poses);
    const assigned = assignIds(this.tracks, found, this.ids);
    this.tracks = assigned.tracks;
    this.subjects = assigned.subjects.map((subject) =>
      smoothSubject(this.previousSubjects.find((item) => item.id === subject.id) ?? null, subject),
    );
    this.previousSubjects = this.subjects;
    const subject = selectSubject(this.subjects, this.selectedId);
    if (subject) this.steady.pushLandmark(performance.now(), subject.eye.x, subject.eye.y);
  }

  private render(time: number): void {
    const width = this.imageWidth;
    const height = this.imageHeight;
    if (width < 2 || height < 2 || !this.overlayCtx) return;
    const subject = selectSubject(this.subjects, this.selectedId);
    if (subject && this.llmAnchor && Math.hypot(subject.eye.x - this.llmAnchor.x, subject.eye.y - this.llmAnchor.y) > 0.08) {
      this.llm = null;
      this.llmAnchor = null;
    }
    const steady = this.steady.isSteady(time);
    const plan = planFrame({
      imageWidth: width,
      imageHeight: height,
      subjects: this.subjects,
      selectedId: this.selectedId,
      aspect: this.aspect,
      rollDeg: this.mode === "demo" ? this.demo.roll : this.motion.roll(),
      steady,
      mirror: this.mirror,
      llm: this.cloudWanted && this.cloudOk ? this.llm : null,
    });
    this.rawGuidance = plan.guidance;
    const stable = stabilizeGuidance(this.guidanceMemory, plan.guidance);
    this.guidanceMemory = stable.memory;
    this.prompt.textContent = this.copy.guidance[stable.code];
    this.prompt.dataset.tone = plan.guidance === "ready" ? "ready" : plan.guidance === "closer" || plan.guidance === "back" ? "warn" : "move";
    const hints: string[] = [];
    if (this.subjects.length > 1) hints.push(this.copy.several);
    if (window.innerWidth > window.innerHeight * 1.08) hints.push(this.copy.rotateHint);
    this.hint.textContent = hints.join(" · ");
    this.shutterButton.classList.toggle("ready", plan.ready);
    this.shutterButton.style.setProperty("--align", plan.alignment.toFixed(3));
    drawOverlay(this.overlayCtx, {
      width: this.overlay.clientWidth,
      height: this.overlay.clientHeight,
      imageWidth: width,
      imageHeight: height,
      mirror: this.mirror,
      plan,
      subjects: this.subjects,
      roll: this.mode === "demo" ? this.demo.roll : this.motion.roll(),
    });
    if (this.voice && stable.code !== this.spokenCode) {
      this.spokenCode = stable.code;
      speakPrompt(this.copy.guidance[stable.code], this.locale);
    }
    if (plan.ready && !this.wasReady) pulse(24);
    this.wasReady = plan.ready;
    document.body.dataset.guidance = plan.guidance;
    if (this.screen === "live") {
      const fire = this.autoShutter.update(plan.ready);
      if (fire && this.auto) this.capture();
    }
    if (subject && steady && this.cloudWanted && this.cloudOk && !this.cloudFlight && time - this.lastCloud > 8000) {
      if (!this.llmAnchor || Math.hypot(subject.eye.x - this.llmAnchor.x, subject.eye.y - this.llmAnchor.y) > 0.05) {
        void this.askCloud(width, height, subject, plan);
      }
    }
  }

  private async askCloud(width: number, height: number, subject: Subject, plan: FramePlan): Promise<void> {
    const source = this.currentSource();
    if (!source) return;
    this.cloudFlight = true;
    this.lastCloud = performance.now();
    try {
      const suggestion = await requestCloudCrop({
        imageDataUrl: snapshotDataUrl(source.canvas, source.width, source.height),
        aspect: this.aspect,
        imageWidth: width,
        imageHeight: height,
        locale: this.locale,
        subject,
        rulesBox: plan.crop,
      });
      if (suggestion) {
        this.llm = suggestion;
        this.llmAnchor = { x: subject.eye.x, y: subject.eye.y };
      }
    } catch {
      this.showToast(this.copy.cloudFail);
    } finally {
      this.cloudFlight = false;
    }
  }

  private capture(): void {
    if (this.capturing || this.screen !== "live") return;
    const source = this.currentSource();
    if (!source) return;
    this.capturing = true;
    const subject = selectSubject(this.subjects, this.selectedId);
    this.shot = {
      source: source.canvas,
      width: source.width,
      height: source.height,
      subject,
      roll: this.mode === "demo" ? this.demo.roll : this.motion.roll(),
      llm: this.llm,
      mirror: this.mirror,
      aspect: this.aspect,
    };
    const flash = must<HTMLElement>("flash");
    flash.classList.remove("go");
    void flash.offsetWidth;
    flash.classList.add("go");
    shutterClick();
    pulse(16);
    this.show("review");
    this.capturing = false;
  }

  private currentSource(): { canvas: HTMLCanvasElement; width: number; height: number } | null {
    if (this.mode === "demo") {
      if (this.demoCanvas.width < 2) return null;
      return { canvas: this.demoCanvas, width: this.demoCanvas.width, height: this.demoCanvas.height };
    }
    if (this.video.videoWidth < 2) return null;
    const canvas = canvasFromVideo(this.video);
    return { canvas, width: canvas.width, height: canvas.height };
  }

  private paintReview(): void {
    if (!this.shot) return;
    const plan = planFrame({
      imageWidth: this.shot.width,
      imageHeight: this.shot.height,
      subjects: this.shot.subject ? [this.shot.subject] : [],
      selectedId: this.shot.subject?.id ?? null,
      aspect: this.aspect,
      rollDeg: this.shot.roll,
      steady: true,
      mirror: false,
      llm: this.shot.llm,
    });
    const cropped = renderCrop(this.shot.source, this.shot.width, this.shot.height, plan.crop, this.shot.mirror);
    if (this.reviewUrl) URL.revokeObjectURL(this.reviewUrl);
    canvasToJpeg(cropped)
      .then((blob) => {
        this.reviewUrl = URL.createObjectURL(blob);
        const image = must<HTMLImageElement>("review-img");
        image.src = this.reviewUrl;
        const note = [this.copy.framing[plan.framing]];
        if (!this.shot?.subject) note.unshift(this.copy.noSubjectSave);
        else if (plan.quality === "low") note.push(this.copy.qualityLow);
        else if (plan.quality === "ok") note.push(this.copy.qualityOk);
        if (plan.llmReasoning) note.push(plan.llmReasoning);
        image.alt = note.join(" ");
        text("review-note", note.join(" "));
      })
      .catch(() => this.showToast(this.copy.cameraError));
    this.renderAspectGroup(must("review-aspects"), this.aspectHandler);
    this.renderAspectGroup(must("aspects"), this.aspectHandler);
  }

  private async save(all: boolean): Promise<void> {
    if (!this.shot) return;
    const aspects = all ? ASPECT_IDS : [this.aspect];
    const files: { name: string; data: Uint8Array }[] = [];
    for (const aspect of aspects) {
      const plan = planFrame({
        imageWidth: this.shot.width,
        imageHeight: this.shot.height,
        subjects: this.shot.subject ? [this.shot.subject] : [],
        selectedId: this.shot.subject?.id ?? null,
        aspect,
        rollDeg: this.shot.roll,
        steady: true,
        llm: this.shot.llm,
      });
      const cropped = renderCrop(this.shot.source, this.shot.width, this.shot.height, plan.crop, this.shot.mirror);
      const blob = await canvasToJpeg(cropped);
      const name = `framing-cam-${aspect.replace(":", "x")}.jpg`;
      if (!all) {
        downloadBlob(blob, name);
        return;
      }
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const zipped = zipStore(files);
    const bytes = new ArrayBuffer(zipped.byteLength);
    new Uint8Array(bytes).set(zipped);
    downloadBlob(new Blob([bytes], { type: "application/zip" }), "framing-cam.zip");
  }

  private pickSubject(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    const width = this.imageWidth;
    const height = this.imageHeight;
    if (width < 2) return;
    const rect = this.overlay.getBoundingClientRect();
    const point = screenToImage(
      event.clientX - rect.left,
      event.clientY - rect.top,
      coverTransform(width, height, rect.width, rect.height),
      this.mirror,
    );
    let best: Subject | null = null;
    let bestDistance = 0.16;
    for (const subject of this.subjects) {
      const distance = Math.hypot(subject.eye.x - point.x, subject.eye.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = subject;
      }
    }
    if (best) this.selectedId = best.id;
  }

  private resize(): void {
    const rect = this.overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.max(1, Math.round(rect.width * dpr));
    this.overlay.height = Math.max(1, Math.round(rect.height * dpr));
    this.overlayCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private show(screen: ScreenName): void {
    this.screen = screen;
    this.gate.hidden = screen !== "gate";
    this.live.hidden = screen !== "live";
    this.review.hidden = screen !== "review";
    document.body.dataset.screen = screen;
    if (screen === "review") this.paintReview();
    if (screen === "live") this.resize();
  }

  private bootVision(): Promise<void> {
    if (this.vision?.ready) return Promise.resolve();
    if (this.visionBoot) return this.visionBoot;
    const pending = new Promise<void>((resolve, reject) => {
      const client = new VisionClient();
      const timer = window.setTimeout(() => {
        client.close();
        reject(new Error("timeout"));
      }, 25000);
      client.onReady = () => {
        window.clearTimeout(timer);
        this.vision = client;
        client.onResult = (perception) => this.onPerception(perception);
        client.onError = () => this.showToast(this.copy.modelError);
        resolve();
      };
      client.onError = (message) => {
        if (this.vision?.ready) return;
        window.clearTimeout(timer);
        client.close();
        reject(new Error(message));
      };
      client.init({
        wasmPath: vendorUrl("vendor/wasm"),
        poseModel: vendorUrl("vendor/models/pose_landmarker_lite.task"),
        faceModel: vendorUrl("vendor/models/face_landmarker.task"),
      });
    });
    this.visionBoot = pending.then(
      () => undefined,
      (error: unknown) => {
        this.visionBoot = null;
        throw error;
      },
    );
    return this.visionBoot;
  }

  private clampDemo(): void {
    this.demo.eyeX = Math.min(0.92, Math.max(0.08, this.demo.eyeX));
    this.demo.eyeY = Math.min(0.82, Math.max(0.08, this.demo.eyeY));
    this.demo.headH = Math.min(0.46, Math.max(0.05, this.demo.headH));
  }

  private get mirror(): boolean {
    return this.mode === "camera" && this.facing === "user";
  }

  private get imageWidth(): number {
    return this.mode === "demo" ? this.demoCanvas.width : this.video.videoWidth;
  }

  private get imageHeight(): number {
    return this.mode === "demo" ? this.demoCanvas.height : this.video.videoHeight;
  }

  private showToast(message: string): void {
    this.toast.hidden = false;
    this.toast.textContent = message;
  }

  private hideToast(): void {
    this.toast.hidden = true;
  }
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

function text(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function press(id: string, on: boolean, label: string): void {
  const button = document.getElementById(id);
  if (!button) return;
  button.setAttribute("aria-pressed", String(on));
  button.textContent = label;
}
