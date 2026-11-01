import { assertSameOrigin } from "../camera/pixels";
import { attachCamera, grabInferencePixels, stopStream, type Facing } from "../camera/stream";
import { applyLevel, insetCrop, shouldLevel, stillFromVideo } from "../camera/still";
import { ASPECT_IDS, type AspectId, type FramePlan, type GuidanceCode, type LlmSuggestion, type Rect, type Subject } from "../composition/types";
import { planFrame, stabilizeGuidance, type GuidanceMemory } from "../composition/plan";
import { assignIds, detectSubjects, selectSubject, smoothSubject, subjectFromFaceAndPose, subjectRegion, type TrackPoint } from "../composition/subject";
import { AutoShutter, SteadyDetector } from "../composition/steady";
import { cloudAvailable, requestShotPlans } from "../cloud/client";
import { LiveGuide } from "../guidance/live";
import { classifyShot } from "../composition/measure";
import { normalizeShotSize, type FrameSize } from "../composition/intent";
import { pickShutterFrame, type ShutterSnap } from "../camera/shutter-pick";
import { compositionScore, meanLuminance, smoothScore } from "../guidance/quality";
import { laplacianVariance } from "../guidance/sharpness";
import { planIsStale } from "../guidance/stale";
import { fallbackPlans } from "../plans/fallback";
import type { ShotPlan } from "../plans/types";
import { applyGuidance, DEMO_HEIGHT, DEMO_START, DEMO_WIDTH, subjectFromDemo, type DemoState } from "../demo/person";
import { drawDemo } from "../demo/draw";
import { copyFor, readLocale, storeLocale, type LocaleId } from "../i18n";
import type { Copy } from "../i18n/en";
import { MotionLevel } from "../sensors/listen";
import { canvasFromVideo, canvasToJpeg, downloadBlob, pulse, renderCrop, shutterClick, snapshotDataUrl, speakPrompt, unlockAudio } from "./capture";
import { zipStore } from "../export/zip";
import { coverTransform, screenToImage } from "../composition/geometry";
import { must, press, text } from "./dom";
import { drawOverlay, strokeFigure } from "./overlay";
import { vendorUrl, VisionClient } from "../vision/client";
import { prefersMainThread } from "../vision/loader";

type SpeechRec = {
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type Mode = "camera" | "demo";
type ScreenName = "gate" | "live" | "review";

type Shot = {
  source: HTMLCanvasElement;
  width: number;
  height: number;
  subject: Subject | null;
  roll: number | null;
  llm: LlmSuggestion | null;
  shotPlan: ShotPlan | null;
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
  private readonly toast = must<HTMLElement>("toast");
  private readonly shutterButton = must<HTMLButtonElement>("shutter");
  private readonly about = must<HTMLDialogElement>("about");

  private copy: Copy = copyFor("zh-CN");
  private locale: LocaleId = "zh-CN";
  private aspect: AspectId = "4:5";
  private facing: Facing = "environment";
  private shoot: "other" | "self" = "other";
  private alignedSince = 0;
  private frameCamera = false;
  private visionTries = 0;
  private visionInFlight: Promise<void> | null = null;
  private mode: Mode = "camera";
  private screen: ScreenName = "gate";
  private auto = true;
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
  private plans: ShotPlan[] = [];
  private planIndex = 0;
  private liveGuide = new LiveGuide();
  private lastStuck = false;
  private lastMagnitude = 0;
  private lastStage: "little" | "lot" | "none" = "none";
  private anchorBox: Rect | null = null;
  private missingSince: number | null = null;
  private countdownMs = 0;
  private countdownEnds = 0;
  private snaps: ShutterSnap[] = [];
  private lastSnap = 0;
  private lastQuality = 0;
  private analyzing = false;
  private didAutoPlan = false;
  private faceCount = 0;
  private poseCount = 0;
  private detectTimes: number[] = [];
  private lastDetectError = "";
  private visionFaults = 0;
  private cameraOpenedAt = 0;
  private cameraPaced = false;
  private recognition: SpeechRec | null = null;
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
    if (params.get("mode") === "self") {
      this.shoot = "self";
      this.facing = "user";
      document.body.dataset.shoot = "self";
    }
    const demo = params.get("demo");
    if (demo === "1" || demo === "auto") this.openDemo(demo === "auto");
    else void this.ensureVision();
    if (params.has("probe")) this.exposeProbe();
  }

  private probeHold = false;
  private probeSize: { width: number; height: number } | null = null;
  private probeWait: ((result: { faces: number; poses: number; frameWidth: number; frameHeight: number; box: string }) => void) | null = null;

  private exposeProbe(): void {
    const host = window as unknown as {
      __detect?: (dataUrl: string) => Promise<{ faces: number; poses: number; frameWidth: number; frameHeight: number }>;
      __bitmapSize?: () => Promise<{ videoWidth: number; width: number }>;
    };
    host.__bitmapSize = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 24;
      const context = canvas.getContext("2d");
      if (!context) return { videoWidth: -1, width: 0 };
      context.fillRect(0, 0, 32, 24);
      const bitmap = await createImageBitmap(canvas);
      const videoWidth = "videoWidth" in bitmap ? Number((bitmap as unknown as { videoWidth: number }).videoWidth) : -1;
      const width = bitmap.width;
      bitmap.close();
      return { videoWidth, width };
    };
    host.__detect = (dataUrl: string) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          void this.ensureVision().then(() => {
            if (!this.vision?.ready) {
              reject(new Error(document.getElementById("vision-status")?.textContent || "not ready"));
              return;
            }
            const pixels = grabInferencePixels(image, image.naturalWidth, image.naturalHeight);
            this.probeHold = true;
            this.probeSize = { width: pixels.width, height: pixels.height };
            this.probeWait = (result) => {
              this.probeHold = false;
              this.probeSize = null;
              resolve(result);
            };
            this.vision.send(pixels, performance.now());
          });
        };
        image.onerror = () => reject(new Error("image"));
        image.src = dataUrl;
      });
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
    this.renderModes();
    must<HTMLButtonElement>("auto").addEventListener("click", () => {
      this.auto = !this.auto;
      this.autoShutter = new AutoShutter();
      this.countdownEnds = 0;
      this.applyToggles();
    });
    must<HTMLFormElement>("style-bar").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.analyze();
    });
    this.bindMic();
    must<HTMLButtonElement>("debug-toggle").addEventListener("click", () => {
      const panel = document.getElementById("debug");
      if (panel) panel.hidden = !panel.hidden;
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
    text("analyze", this.copy.analyze);
    text("mic", this.copy.listen);
    text("stale", this.copy.stale);
    const styleInput = document.getElementById("style-input");
    if (styleInput instanceof HTMLInputElement) styleInput.placeholder = this.copy.stylePlaceholder;
    this.renderCounts();
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
    press("auto", this.auto, this.copy.auto);
    this.renderModes();
  }

  private renderModes(): void {
    const row = document.getElementById("modes");
    if (!row) return;
    row.replaceChildren();
    const options: ["other" | "self", string][] = [
      ["other", this.copy.modeOther],
      ["self", this.copy.modeSelf],
    ];
    for (const [id, label] of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(this.shoot === id));
      button.addEventListener("click", () => void this.setShoot(id));
      row.append(button);
    }
  }

  private async setShoot(mode: "other" | "self"): Promise<void> {
    if (this.shoot === mode) return;
    this.shoot = mode;
    this.alignedSince = 0;
    this.countdownEnds = 0;
    document.body.dataset.shoot = mode;
    this.renderModes();
    const next: Facing = mode === "self" ? "user" : "environment";
    if (this.mode === "camera" && this.facing !== next) {
      this.facing = next;
      stopStream(this.stream);
      try {
        this.stream = await attachCamera(this.video, this.facing);
        this.video.classList.toggle("mirror", this.facing === "user");
        this.resetTracking();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.showToast(`${this.copy.cameraError} ${reason}`);
      }
    } else {
      this.facing = next;
    }
  }

  private phrase(code: GuidanceCode, stage: "little" | "lot" | "none" = "none"): string {
    const base = (this.shoot === "self" ? this.copy.selfie : this.copy.holder)[code];
    if (stage === "none" || code === "searching" || code === "steady" || code === "ready") return base;
    return stage === "lot" ? `${base}，多一些` : `${base}，就一点`;
  }

  private setPreparing(on: boolean): void {
    const chip = document.getElementById("preparing");
    if (!chip) return;
    chip.hidden = !on;
    chip.textContent = this.copy.preparing;
  }

  private async openCamera(): Promise<void> {
    if (!window.isSecureContext) {
      this.showToast(this.copy.insecure);
      return;
    }
    const button = must<HTMLButtonElement>("open-camera");
    button.disabled = true;
    try {
      await this.motion.request();
      unlockAudio();
      this.cameraOpenedAt = performance.now();
      if (new URLSearchParams(location.search).get("fakecam") === "frames") {
        this.frameCamera = true;
        this.mode = "camera";
        this.video.hidden = true;
        this.demoCanvas.hidden = false;
        this.demoCanvas.width = 480;
        this.demoCanvas.height = 640;
        this.demoCanvas.classList.toggle("mirror", this.facing === "user");
        must<HTMLElement>("badge").hidden = true;
        must<HTMLElement>("demo-pad").hidden = true;
        this.resetTracking();
        this.show("live");
        this.startLoop();
        this.setPreparing(!this.vision?.ready);
        void this.ensureVision();
        return;
      }
      this.stream = await attachCamera(this.video, this.facing);
      this.mode = "camera";
      this.video.hidden = false;
      this.demoCanvas.hidden = true;
      this.video.classList.toggle("mirror", this.facing === "user");
      must<HTMLElement>("badge").hidden = true;
      must<HTMLElement>("demo-pad").hidden = true;
      this.resetTracking();
      this.show("live");
      this.startLoop();
      this.setPreparing(!this.vision?.ready);
      void this.ensureVision();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.showToast(reason ? `${this.copy.cameraError} ${reason}` : this.copy.cameraError);
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
    this.buildPad();
    this.resetTracking();
    this.show("live");
    this.startLoop();
    void this.ensureVision();
  }

  private resetTracking(): void {
    this.subjects = [];
    this.previousSubjects = [];
    this.tracks = [];
    this.selectedId = null;
    this.llm = null;
    this.llmAnchor = null;
    this.plans = [];
    this.planIndex = 0;
    this.anchorBox = null;
    this.didAutoPlan = false;
    this.snaps = [];
    this.renderPlanCards();
    this.steady.reset();
    this.autoShutter = new AutoShutter();
    this.guidanceMemory = null;
    this.liveGuide.reset(performance.now());
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
      if (this.vision?.ready && !this.probeHold && time - this.lastGrab > 220) {
        this.lastGrab = time;
        void this.sendDemoFrame(time);
      }
    } else if (this.frameCamera && time - this.lastGrab > 80) {
      this.lastGrab = time;
      void this.sendCanvasFrame(time);
    } else if (!this.cameraPaced && this.video.readyState >= 2 && time - this.lastGrab > (this.vision?.place === "main" ? 120 : 66)) {
      this.lastGrab = time;
      void this.sendFrame(time);
      if (this.video.videoWidth < 2 && this.cameraOpenedAt && time - this.cameraOpenedAt > 4000) {
        this.setVisionStatus(this.copy.frameFail);
      }
    }
    this.steady.pushAccel(time, this.motion.linearG);
    this.render(time);
  };

  private async sendDemoFrame(time: number): Promise<void> {
    if (!this.vision?.ready) return;
    try {
      const pixels = grabInferencePixels(this.demoCanvas, this.demoCanvas.width, this.demoCanvas.height);
      this.vision.send(pixels, time);
    } catch (error) {
      this.noteVisionFailure(error instanceof Error ? error.message : "frame", true);
    }
  }

  private armCameraCallback(): void {
    const video = this.video;
    if (this.vision?.place !== "main" || !video.requestVideoFrameCallback) return;
    this.cameraPaced = true;
    video.requestVideoFrameCallback(() => {
      if (!this.cameraPaced || !this.running || this.screen !== "live" || this.mode !== "camera") return;
      void this.sendFrame(performance.now());
      this.armCameraCallback();
    });
  }

  private async sendCanvasFrame(time: number): Promise<void> {
    if (!this.vision?.ready || this.demoCanvas.width < 2) return;
    try {
      const pixels = grabInferencePixels(this.demoCanvas, this.demoCanvas.width, this.demoCanvas.height);
      this.vision.send(pixels, time);
      const subject = selectSubject(this.subjects, this.selectedId);
      if (subject) this.steady.pushLandmark(time, subject.eye.x, subject.eye.y);
    } catch (error) {
      this.noteVisionFailure(error instanceof Error ? error.message : "frame", true);
    }
  }

  private async sendFrame(time: number): Promise<void> {
    if (!this.vision?.ready || this.video.videoWidth < 2 || this.video.videoHeight < 2) return;
    try {
      const pixels = grabInferencePixels(this.video, this.video.videoWidth, this.video.videoHeight);
      this.vision.send(pixels, time);
    } catch (error) {
      this.noteVisionFailure(error instanceof Error ? error.message : "frame", true);
    }
  }

  private onPerception(perception: { faces: Parameters<typeof detectSubjects>[0]; poses: Parameters<typeof detectSubjects>[1] }): void {
    this.faceCount = perception.faces.length;
    this.poseCount = perception.poses.length;
    const now = performance.now();
    this.detectTimes.push(now);
    this.detectTimes = this.detectTimes.filter((stamp) => now - stamp < 1000);
    if (this.probeWait) {
      const frameWidth = this.vision?.frameWidth ?? 0;
      const frameHeight = this.vision?.frameHeight ?? 0;
      const matches = !this.probeSize || (frameWidth === this.probeSize.width && frameHeight === this.probeSize.height);
      if (matches) {
        const resolve = this.probeWait;
        this.probeWait = null;
        const face = perception.faces[0];
        const made = face ? subjectFromFaceAndPose(face, perception.poses[0] ?? null) : null;
        const box = made ? subjectRegion({ ...made, id: "probe" }) : null;
        resolve({
          faces: perception.faces.length,
          poses: perception.poses.length,
          frameWidth,
          frameHeight,
          box: box ? [box.x, box.y, box.w, box.h].map((value) => Number(value.toFixed(3))).join(",") : "",
        });
      }
    }
    const heard = perception as { eyesClosed?: boolean; maskHeadTop?: number | null };
    this.liveGuide.noteDetection(now, this.motion.gammaPerSec, Boolean(heard.eyesClosed));
    if (this.mode === "demo") return;
    const found = detectSubjects(perception.faces, perception.poses);
    const assigned = assignIds(this.tracks, found, this.ids);
    this.tracks = assigned.tracks;
    const maskTop = heard.maskHeadTop;
    this.subjects = assigned.subjects.map((subject) => {
      const crowned = maskTop != null && maskTop < subject.chinY - 0.01 ? { ...subject, headTop: maskTop } : subject;
      return smoothSubject(this.previousSubjects.find((item) => item.id === subject.id) ?? null, crowned);
    });
    this.previousSubjects = this.subjects;
    const subject = selectSubject(this.subjects, this.selectedId);
    if (subject) this.steady.pushLandmark(performance.now(), subject.eye.x, subject.eye.y);
  }

  private renderCounts(): void {
    const counts = document.getElementById("counts");
    if (!counts) return;
    counts.replaceChildren();
    const options: [number, string][] = [
      [0, this.copy.countdownNow],
      [1000, this.copy.countdown1],
      [3000, this.copy.countdown3],
    ];
    for (const [ms, label] of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(this.countdownMs === ms));
      button.addEventListener("click", () => {
        this.countdownMs = ms;
        this.countdownEnds = 0;
        this.renderCounts();
      });
      counts.append(button);
    }
  }

  private bindMic(): void {
    const mic = must<HTMLButtonElement>("mic");
    const finish = () => this.endListen();
    mic.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      mic.setPointerCapture?.(event.pointerId);
      this.beginListen();
    });
    mic.addEventListener("pointerup", finish);
    mic.addEventListener("pointercancel", finish);
  }

  private speechCtor(): (new () => SpeechRec) | null {
    const host = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    return host.SpeechRecognition || host.webkitSpeechRecognition || null;
  }

  private beginListen(): void {
    const input = document.getElementById("style-input");
    const Ctor = this.speechCtor();
    const mic = document.getElementById("mic");
    if (!Ctor || !(input instanceof HTMLInputElement)) {
      input instanceof HTMLInputElement && input.focus();
      this.showToast(this.copy.noSpeech);
      return;
    }
    this.setFlow(this.copy.listening);
    mic?.classList.add("listening");
    const recognition = new Ctor();
    recognition.lang = this.locale === "en" ? "en-US" : "zh-CN";
    recognition.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      if (said) input.value = said;
    };
    recognition.onerror = () => this.setFlow("");
    recognition.onend = () => {
      mic?.classList.remove("listening");
      if (input.value.trim()) void this.analyze();
      else this.setFlow("");
    };
    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.showToast(this.copy.noSpeech);
      this.setFlow("");
    }
  }

  private endListen(): void {
    document.getElementById("mic")?.classList.remove("listening");
    try {
      this.recognition?.stop();
    } catch {
      /* already stopped by silence */
    }
  }

  private setFlow(label: string): void {
    const flow = document.getElementById("flow");
    if (!flow) return;
    flow.hidden = !label;
    flow.textContent = label;
  }

  private preferCpu(): boolean {
    const ua = navigator.userAgent;
    return /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  private zoomRange(): { min: number; max: number; current: number } {
    const track = this.stream?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as { zoom?: { min?: number; max?: number } } | undefined;
    const settings = track?.getSettings?.() as { zoom?: number } | undefined;
    return { min: caps?.zoom?.min ?? 1, max: caps?.zoom?.max ?? 1, current: settings?.zoom ?? 1 };
  }

  private async analyze(): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    this.setFlow(this.copy.analyzing);
    const input = document.getElementById("style-input");
    const style = input instanceof HTMLInputElement && input.value.trim() ? input.value.trim() : "自然";
    const subject = selectSubject(this.subjects, this.selectedId);
    const box = subject ? subjectRegion(subject) : null;
    const source = this.currentSource();
    let plans: ShotPlan[] | null = null;
    if (this.cloudOk && source) {
      plans = await requestShotPlans({
        imageDataUrl: snapshotDataUrl(source.canvas, source.width, source.height),
        aspect: this.aspect,
        imageWidth: source.width,
        imageHeight: source.height,
        locale: this.locale,
        style,
        rollDeg: this.mode === "demo" ? this.demo.roll : this.motion.roll(),
        zoom: this.zoomRange(),
        subject: subject
          ? {
              box,
              eyeX: subject.eye.x,
              eyeY: subject.eye.y,
              headTop: subject.headTop,
              chinY: subject.chinY,
              yaw: subject.yaw,
              shouldersY: subject.shouldersY,
              joints: subject.joints,
            }
          : null,
      });
    }
    this.plans = plans && plans.length >= 2 ? plans : fallbackPlans(style, box, this.frameSize());
    this.planIndex = this.planForSubject(subject);
    this.planIndex = 0;
    this.anchorBox = box;
    this.liveGuide.reset(performance.now());
    this.missingSince = null;
    this.countdownEnds = 0;
    this.renderPlanCards();
    this.setFlow("");
    this.analyzing = false;
  }

  private renderPlanCards(): void {
    const row = document.getElementById("plans");
    if (!row) return;
    row.hidden = this.plans.length === 0;
    row.replaceChildren();
    this.plans.forEach((plan, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "plan-card";
      button.setAttribute("aria-pressed", String(index === this.planIndex));
      const canvas = document.createElement("canvas");
      canvas.width = 112;
      canvas.height = 148;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#241f1a";
        ctx.fillRect(0, 0, 112, 148);
        const box = plan.targetBox;
        strokeFigure(ctx, { x: box.x * 112, y: box.y * 148, w: box.w * 112, h: box.h * 148 }, "#f6f1e7", 3, []);
      }
      const title = document.createElement("strong");
      title.textContent = plan.title.slice(0, 6);
      button.append(canvas, title);
      button.addEventListener("click", () => {
        this.planIndex = index;
        this.liveGuide.reset(performance.now());
        this.renderPlanCards();
      });
      row.append(button);
    });
    document.body.dataset.plans = String(this.plans.length);
  }

  private rememberFrame(time: number): void {
    if (time - this.lastSnap < 160) return;
    const source = this.currentSource();
    if (!source) return;
    this.lastSnap = time;
    const probe = document.createElement("canvas");
    probe.width = 64;
    probe.height = 64;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(source.canvas, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64);
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")?.drawImage(source.canvas, 0, 0);
    this.snaps.push({ canvas: copy, score: laplacianVariance(pixels.data, 64, 64), at: time, eyesOpen: !this.liveGuide.eyesClosed });
    if (this.snaps.length > 5) this.snaps.shift();
    if (time - this.lastQuality > 280) {
      this.lastQuality = time;
      const quality = compositionScore({
        subject: this.anchorBox,
        luminance: meanLuminance(pixels.data),
        rollDeg: this.mode === "demo" ? this.demo.roll : this.motion.roll(),
      });
      if (laplacianVariance(pixels.data, 64, 64) < 30) quality.warnings.unshift("blur");
      const warnings = document.getElementById("warnings");
      if (warnings) {
        const labels: Record<string, string> = {
          blur: this.copy.warnBlur,
          tilt: this.copy.warnTilt,
          horizon: this.copy.warnHorizon,
          dark: this.copy.warnDark,
          bright: this.copy.warnBright,
        };
        warnings.textContent = quality.warnings.map((warning) => labels[warning]).join(" · ");
      }
      this.smoothed = smoothScore(this.smoothed, quality.score);
    }
  }

  private smoothed: number | null = null;

  private render(time: number): void {
    const width = this.imageWidth;
    const height = this.imageHeight;
    if (width < 2 || height < 2 || !this.overlayCtx) return;
    this.rememberFrame(time);
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
    const region = subject ? subjectRegion(subject) : null;
    if (!this.didAutoPlan && region && this.plans.length === 0 && this.screen === "live" && !this.analyzing) {
      this.didAutoPlan = true;
      const typed = document.getElementById("style-input");
      const style = typed instanceof HTMLInputElement && typed.value.trim() ? typed.value.trim() : "自然";
      this.plans = fallbackPlans(style, region, this.frameSize());
      this.planIndex = subject ? this.planForSubject(subject) : 0;
      this.anchorBox = region;
      this.liveGuide.reset(time);
      this.renderPlanCards();
    }
    const active = this.plans[this.planIndex];
    const roll = this.mode === "demo" ? this.demo.roll : this.motion.roll();
    let guideTarget: Rect | null = null;
    let guideAligned = false;
    let promptCode: GuidanceCode = plan.guidance;
    let promptText = "";
    let bar = plan.alignment;
    let readyNow = plan.ready;
    let measured: Rect | null = region;
    if (active) {
      if (!region) this.missingSince = this.missingSince ?? time;
      else this.missingSince = null;
      const missing = this.missingSince == null ? 0 : time - this.missingSince;
      const stale = this.anchorBox ? planIsStale(this.anchorBox, region, active.targetBox, missing) : false;
      const staleEl = document.getElementById("stale");
      if (staleEl) staleEl.hidden = !stale;
      const step = this.liveGuide.update({
        now: time,
        subject,
        shotSize: normalizeShotSize(active.shotSize),
        frame: this.frameSize(),
        rollDeg: roll,
        steady,
        eyeLine: active.eyeLine,
        headroom: active.headroom,
        horizontal: active.horizontal,
      });
      measured = step.rect ?? region;
      guideTarget = step.targetBox ?? active.targetBox;
      this.lastStuck = step.stuck;
      this.lastMagnitude = step.stage === "lot" ? 1.35 : step.stage === "little" ? 0.45 : 0.15;
      this.lastStage = step.stage;
      guideAligned = step.aligned && !stale && step.complete;
      bar = step.score;
      readyNow = step.hint === "ready" && !stale && step.complete && !this.liveGuide.eyesClosed;
      promptCode = step.hint === "hold" ? "steady" : step.hint;
      promptText = stale ? this.copy.stale : this.phrase(promptCode, step.stage);
      this.rawGuidance = promptCode;
      if (!readyNow) {
        this.alignedSince = 0;
        this.countdownEnds = 0;
      } else if (this.screen === "live" && this.auto) {
        if (!this.alignedSince) this.alignedSince = time;
        const held = time - this.alignedSince;
        if (this.shoot === "self") {
          if (!this.countdownEnds) this.countdownEnds = this.alignedSince + 3000;
          const left = Math.max(1, Math.ceil((this.countdownEnds - time) / 1000));
          promptText = String(left);
          if (time >= this.countdownEnds && held >= 1000) this.capture();
        } else if (held >= 1000) {
          this.capture();
        }
      }
    } else {
      const staleEl = document.getElementById("stale");
      if (staleEl) staleEl.hidden = true;
      this.rawGuidance = plan.guidance;
      const stable = stabilizeGuidance(this.guidanceMemory, plan.guidance);
      this.guidanceMemory = stable.memory;
      promptCode = stable.code;
      promptText = this.phrase(stable.code);
      if (this.screen === "live") {
        const fire = this.autoShutter.update(plan.ready);
        if (fire && this.auto) this.capture();
      }
    }
    this.prompt.textContent = promptText;
    this.prompt.dataset.tone = readyNow ? "ready" : promptCode === "closer" || promptCode === "back" ? "warn" : "move";
    const scorebar = document.getElementById("scorebar");
    if (scorebar) scorebar.dataset.tone = readyNow ? "ready" : "move";
    this.shutterButton.classList.toggle("ready", readyNow);
    this.shutterButton.style.setProperty("--align", bar.toFixed(3));
    const fill = document.getElementById("scorefill");
    if (fill) fill.style.width = `${Math.round(bar * 100)}%`;
    drawOverlay(this.overlayCtx, {
      width: this.overlay.clientWidth,
      height: this.overlay.clientHeight,
      imageWidth: width,
      imageHeight: height,
      mirror: this.mirror,
      plan,
      subjects: this.subjects,
      roll,
      guideTarget,
      guideSubject: measured,
      guideAligned,
      guideHint: promptCode,
      guideScore: bar,
      guideMagnitude: this.lastMagnitude,
    });
    if (this.shoot === "self" && promptText !== this.spokenCode) {
      this.spokenCode = promptText;
      speakPrompt(promptText, this.locale === "en" ? "en" : "zh-CN");
    }
    if (readyNow && !this.wasReady) {
      pulse(28);
      if (!this.auto) shutterClick();
    }
    this.wasReady = readyNow;
    document.body.dataset.guidance = promptCode;
    document.body.dataset.prompt = promptText;
    document.body.dataset.shoot = this.shoot;
    document.body.dataset.model = this.vision?.ready ? "ready" : "wait";
    document.body.dataset.ready = readyNow ? "1" : "0";
    const shownRect = measured ?? region;
    if (shownRect) {
      document.body.dataset.subject = [shownRect.x, shownRect.y, shownRect.w, shownRect.h].map((value) => value.toFixed(3)).join(",");
    }
    document.body.dataset.stuck = this.lastStuck ? "1" : "0";
    document.body.dataset.magnitude = this.lastStage;
    const summary = this.liveGuide.metrics.summary(time);
    (window as unknown as { __metrics?: unknown }).__metrics = { ...summary, source: "device" };
    this.setPreparing(this.screen === "live" && !this.vision?.ready);
    this.paintDebug();
  }

  private paintDebug(): void {
    const panel = document.getElementById("debug");
    if (!panel || panel.hidden) return;
    const fps = this.detectTimes.length;
    panel.textContent = [
      `detector ${this.vision?.ready ? "ok" : "off"} ${this.vision?.delegate || "—"}`,
      this.vision?.place === "main" && this.vision.note ? `worker ${this.vision.note.slice(0, 80)}` : "",
      `face ${this.vision?.faceReady ? "ok" : "no"}  ${fps} fps`,
      `faces ${this.faceCount}  poses ${this.poseCount}`,
      `people ${this.subjects.length}`,
      `video ${this.video.videoWidth}x${this.video.videoHeight} frame ${this.vision?.frameWidth ?? 0}x${this.vision?.frameHeight ?? 0}`,
      this.lastDetectError ? `err ${this.lastDetectError.slice(0, 80)}` : "err none",
      this.vision?.faceError ? `face ${this.vision.faceError.slice(0, 80)}` : "",
    ].filter(Boolean).join("\n");
  }

  private frameSize(): FrameSize {
    return { width: this.imageWidth, height: this.imageHeight, aspect: this.aspect };
  }

  private planForSubject(subject: Subject | null): number {
    if (!subject) return 0;
    const wanted = classifyShot(subject);
    const index = this.plans.findIndex((plan) => normalizeShotSize(plan.shotSize) === wanted);
    return index >= 0 ? index : 0;
  }

  private capture(): void {
    if (this.capturing || this.screen !== "live" || this.liveGuide.eyesClosed) return;
    const preview = this.currentSource();
    if (!preview) return;
    this.capturing = true;
    void this.finishCapture(preview);
  }

  private async finishCapture(preview: { canvas: HTMLCanvasElement; width: number; height: number }): Promise<void> {
    const roll = this.mode === "demo" ? this.demo.roll : this.motion.roll();
    let source = preview.canvas;
    const best = pickShutterFrame(this.snaps, performance.now());
    if ((this.frameCamera || this.mode === "demo") && best) source = best.canvas;
    try {
      if (this.mode === "camera" && !this.frameCamera) {
        source = await stillFromVideo(this.video, this.stream?.getVideoTracks()[0] ?? null);
      }
      if (shouldLevel(roll) && roll != null) source = applyLevel(source, source.width, source.height, roll);
    } catch {
      source = preview.canvas;
    }
    const subject = selectSubject(this.subjects, this.selectedId);
    this.shot = {
      source,
      width: source.width,
      height: source.height,
      subject,
      roll,
      llm: this.llm,
      shotPlan: this.plans[this.planIndex] ?? null,
      mirror: this.mirror,
      aspect: this.aspect,
    };
    document.body.dataset.captured = "1";
    document.body.dataset.still = `${source.width}x${source.height}`;
    document.body.dataset.stillFrom = this.mode === "demo" || this.frameCamera ? "painted-frame" : "camera";
    this.liveGuide.metrics.markCapture(performance.now());
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
    if (this.mode === "demo" || this.frameCamera) {
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
      shotSize: this.shot.shotPlan?.shotSize,
    });
    const crop = insetCrop(plan.crop, this.shot.roll);
    const cropped = renderCrop(this.shot.source, this.shot.width, this.shot.height, crop, this.shot.mirror);
    if (this.reviewUrl) URL.revokeObjectURL(this.reviewUrl);
    canvasToJpeg(cropped)
      .then((blob) => {
        this.reviewUrl = URL.createObjectURL(blob);
        const image = must<HTMLImageElement>("review-img");
        image.src = this.reviewUrl;
        image.onload = () => {
          document.body.dataset.output = `${image.naturalWidth}x${image.naturalHeight}`;
        };
        const note = this.shot?.shotPlan ? [this.shot.shotPlan.title] : [this.copy.framing[plan.framing]];
        if (!this.shot?.subject) note.unshift(this.copy.noSubjectSave);
        else if (!this.shot.shotPlan && plan.quality === "low") note.push(this.copy.qualityLow);
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
        shotSize: this.shot.shotPlan?.shotSize,
      });
      const crop = insetCrop(plan.crop, this.shot.roll);
      const cropped = renderCrop(this.shot.source, this.shot.width, this.shot.height, crop, this.shot.mirror);
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
    if (target?.closest("button, input, form")) return;
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

  private ensureVision(): Promise<void> {
    if (this.vision?.ready) {
      this.setPreparing(false);
      return Promise.resolve();
    }
    if (this.visionInFlight) return this.visionInFlight;
    this.visionTries = 0;
    this.visionInFlight = this.attemptVision().finally(() => {
      this.visionInFlight = null;
    });
    return this.visionInFlight;
  }

  private attemptVision(): Promise<void> {
    this.visionTries += 1;
    this.setPreparing(this.screen === "live");
    return this.bootVision().then(
      () => {
        this.visionFaults = 0;
        this.setVisionStatus("");
        this.setPreparing(false);
        document.body.dataset.model = "ready";
        document.body.dataset.modelAt = String(Math.round(performance.now()));
      },
      (error: unknown) => {
        this.visionBoot = null;
        if (this.visionTries < 2) return this.attemptVision();
        const reason = error instanceof Error ? error.message : String(error);
        this.noteVisionFailure(reason, false);
        this.setPreparing(false);
      },
    );
  }

  private noteVisionFailure(message: string, ready: boolean): void {
    this.lastDetectError = message;
    this.visionFaults += 1;
    if (!ready || this.visionFaults >= 3) {
      const label = ready ? this.copy.detectFail : this.copy.modelFail;
      this.setVisionStatus(`${label}：${message}`);
    }
  }

  private setVisionStatus(message: string): void {
    const status = document.getElementById("vision-status");
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
  }

  private async probeAssets(urls: string[]): Promise<void> {
    for (const url of urls) {
      const absolute = assertSameOrigin(window.location.href, url);
      const response = await fetch(absolute.href, { headers: { Range: "bytes=0-16" } });
      if (!response.ok) throw new Error(`${response.status} ${absolute.pathname}`);
      await response.body?.cancel();
    }
  }

  private bootVision(): Promise<void> {
    if (this.vision?.ready) return Promise.resolve();
    if (this.visionBoot) return this.visionBoot;
    const pending = new Promise<void>((resolve, reject) => {
      const client = new VisionClient();
      const timer = window.setTimeout(() => {
        client.close();
        reject(new Error(this.copy.modelTimeout));
      }, 50000);
      const paths = {
        wasmPath: vendorUrl("vendor/wasm"),
        poseModel: vendorUrl("vendor/models/pose_landmarker_lite.task"),
        faceModel: vendorUrl("vendor/models/face_landmarker.task"),
        segmentModel: vendorUrl("vendor/models/selfie_multiclass_256x256.tflite"),
        cpuOnly: this.preferCpu(),
        mainThread: prefersMainThread(navigator.userAgent),
      };
        client.onReady = () => {
        window.clearTimeout(timer);
        this.vision = client;
        this.armCameraCallback();
        client.onResult = (perception) => {
          if (this.visionFaults > 0) {
            this.visionFaults = 0;
            this.setVisionStatus("");
          }
          this.onPerception(perception);
        };
        client.onError = (message) => this.noteVisionFailure(message, true);
        resolve();
      };
      client.onError = (message) => {
        this.lastDetectError = message;
        if (this.vision?.ready) return;
        window.clearTimeout(timer);
        client.close();
        reject(new Error(message));
      };
      void this.probeAssets([
        `${paths.wasmPath}/vision_wasm_module_internal.js`,
        `${paths.wasmPath}/vision_wasm_module_internal.wasm`,
        `${paths.wasmPath}/vision_wasm_module_raw_internal.wasm`,
        paths.poseModel,
        paths.faceModel,
      ])
        .then(() => client.init(paths))
        .catch((error: unknown) => {
          window.clearTimeout(timer);
          client.close();
          reject(error instanceof Error ? error : new Error(String(error)));
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
    return this.mode === "demo" || this.frameCamera ? this.demoCanvas.width : this.video.videoWidth;
  }

  private get imageHeight(): number {
    return this.mode === "demo" || this.frameCamera ? this.demoCanvas.height : this.video.videoHeight;
  }

  private showToast(message: string): void {
    this.toast.hidden = false;
    this.toast.textContent = message;
  }

}

