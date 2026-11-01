import { attachCamera, grabInferenceBitmap, stopStream, type Facing } from "../camera/stream";
import { ASPECTS, ASPECT_IDS, type AspectId, type FramePlan, type GuidanceCode, type LlmSuggestion, type Rect, type Subject } from "../composition/types";
import { frameAroundTarget } from "../composition/geometry";
import { planFrame, stabilizeGuidance, type GuidanceMemory } from "../composition/plan";
import { assignIds, detectSubjects, selectSubject, smoothSubject, subjectRegion, type TrackPoint } from "../composition/subject";
import { AutoShutter, SteadyDetector } from "../composition/steady";
import { cloudAvailable, requestShotPlans } from "../cloud/client";
import { initialGuide, stepGuide, type GuideMemory as ShotGuideMemory } from "../guidance/machine";
import { compositionScore, meanLuminance, smoothScore } from "../guidance/quality";
import { laplacianVariance, pickSharpest } from "../guidance/sharpness";
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
import { drawOverlay } from "./overlay";
import { vendorUrl, VisionClient } from "../vision/client";

type SpeechRec = {
  lang: string;
  start: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
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
  private plans: ShotPlan[] = [];
  private planIndex = 0;
  private shotGuide: ShotGuideMemory = initialGuide();
  private anchorBox: Rect | null = null;
  private missingSince: number | null = null;
  private countdownMs = 0;
  private countdownEnds = 0;
  private snaps: { canvas: HTMLCanvasElement; score: number; at: number }[] = [];
  private lastSnap = 0;
  private lastQuality = 0;
  private analyzing = false;
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
      this.countdownEnds = 0;
      this.applyToggles();
    });
    must<HTMLFormElement>("style-bar").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.analyze();
    });
    must<HTMLButtonElement>("mic").addEventListener("click", () => this.listen());
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
    this.plans = [];
    this.planIndex = 0;
    this.anchorBox = null;
    this.snaps = [];
    this.renderPlanCards();
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

  private listen(): void {
    const input = document.getElementById("style-input");
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (!Ctor || !(input instanceof HTMLInputElement)) {
      this.showToast(this.copy.noSpeech);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = this.locale === "en" ? "en-US" : "zh-CN";
    recognition.onresult = (event) => {
      input.value = event.results[0][0].transcript;
    };
    recognition.onerror = () => this.showToast(this.copy.noSpeech);
    recognition.start();
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
    this.plans = plans && plans.length >= 2 ? plans : fallbackPlans(style, box);
    this.planIndex = 0;
    this.anchorBox = box;
    this.shotGuide = initialGuide(performance.now());
    this.missingSince = null;
    this.countdownEnds = 0;
    this.renderPlanCards();
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
      const title = document.createElement("strong");
      title.textContent = plan.title;
      const detail = document.createElement("span");
      detail.textContent = `${plan.holderDirection} · ${plan.poseTip}`;
      button.append(title, detail);
      button.addEventListener("click", () => {
        this.planIndex = index;
        this.shotGuide = initialGuide(performance.now());
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
    this.snaps.push({ canvas: copy, score: laplacianVariance(pixels.data, 64, 64), at: time });
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
    const active = this.plans[this.planIndex];
    const region = subject ? subjectRegion(subject) : null;
    const roll = this.mode === "demo" ? this.demo.roll : this.motion.roll();
    let guideTarget: Rect | null = null;
    let guideAligned = false;
    let promptCode: GuidanceCode = plan.guidance;
    let promptText = "";
    let bar = plan.alignment;
    let readyNow = plan.ready;
    if (active) {
      if (!region) this.missingSince = this.missingSince ?? time;
      else this.missingSince = null;
      const missing = this.missingSince == null ? 0 : time - this.missingSince;
      const stale = this.anchorBox ? planIsStale(this.anchorBox, region, active.targetBox, missing) : false;
      const staleEl = document.getElementById("stale");
      if (staleEl) staleEl.hidden = !stale;
      const step = stepGuide(this.shotGuide, { now: time, subject: region, target: active.targetBox, rollDeg: roll, steady });
      this.shotGuide = step.memory;
      guideTarget = active.targetBox;
      guideAligned = step.aligned && !stale;
      bar = step.score;
      readyNow = step.hint === "ready" && !stale;
      promptCode = step.hint === "hold" ? "steady" : step.hint;
      promptText = stale ? this.copy.stale : this.copy.guidance[promptCode];
      this.rawGuidance = promptCode;
      if (this.screen === "live" && this.auto && readyNow) {
        if (this.countdownMs > 0) {
          if (!this.countdownEnds) this.countdownEnds = time + this.countdownMs;
          promptText = String(Math.max(1, Math.ceil((this.countdownEnds - time) / 1000)));
          if (time >= this.countdownEnds) this.capture();
        } else {
          this.capture();
        }
      } else {
        this.countdownEnds = 0;
      }
    } else {
      const staleEl = document.getElementById("stale");
      if (staleEl) staleEl.hidden = true;
      this.rawGuidance = plan.guidance;
      const stable = stabilizeGuidance(this.guidanceMemory, plan.guidance);
      this.guidanceMemory = stable.memory;
      promptCode = stable.code;
      promptText = this.copy.guidance[stable.code];
      if (this.screen === "live") {
        const fire = this.autoShutter.update(plan.ready);
        if (fire && this.auto) this.capture();
      }
    }
    const stableCode = promptCode;
    this.prompt.textContent = promptText;
    this.prompt.dataset.tone = readyNow ? "ready" : promptCode === "closer" || promptCode === "back" ? "warn" : "move";
    const hints: string[] = [];
    if (active) hints.push(active.poseTip);
    if (this.subjects.length > 1) hints.push(this.copy.several);
    if (window.innerWidth > window.innerHeight * 1.08) hints.push(this.copy.rotateHint);
    this.hint.textContent = hints.filter(Boolean).join(" · ");
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
      guideAligned,
    });
    if (this.voice && stableCode !== this.spokenCode) {
      this.spokenCode = stableCode;
      speakPrompt(promptText, this.locale);
    }
    if (readyNow && !this.wasReady) pulse(24);
    this.wasReady = readyNow;
    document.body.dataset.guidance = promptCode;
  }

  private capture(): void {
    if (this.capturing || this.screen !== "live") return;
    const source = this.currentSource();
    if (!source) return;
    this.capturing = true;
    const best = pickSharpest(this.snaps.filter((snap) => performance.now() - snap.at < 1200));
    const chosen = best ?? { canvas: source.canvas };
    const subject = selectSubject(this.subjects, this.selectedId);
    this.shot = {
      source: chosen.canvas,
      width: chosen.canvas.width,
      height: chosen.canvas.height,
      subject,
      roll: this.mode === "demo" ? this.demo.roll : this.motion.roll(),
      llm: this.llm,
      shotPlan: this.plans[this.planIndex] ?? null,
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
    const crop = this.shot.shotPlan
      ? frameAroundTarget(this.shot.shotPlan.targetBox, ASPECTS[this.aspect], this.shot.width, this.shot.height)
      : plan.crop;
    const cropped = renderCrop(this.shot.source, this.shot.width, this.shot.height, crop, this.shot.mirror);
    if (this.reviewUrl) URL.revokeObjectURL(this.reviewUrl);
    canvasToJpeg(cropped)
      .then((blob) => {
        this.reviewUrl = URL.createObjectURL(blob);
        const image = must<HTMLImageElement>("review-img");
        image.src = this.reviewUrl;
        const note = this.shot?.shotPlan ? [this.shot.shotPlan.title, this.shot.shotPlan.holderDirection] : [this.copy.framing[plan.framing]];
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
      const crop = this.shot.shotPlan
        ? frameAroundTarget(this.shot.shotPlan.targetBox, ASPECTS[aspect], this.shot.width, this.shot.height)
        : plan.crop;
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
