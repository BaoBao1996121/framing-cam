import { normalizeShotSize, placementFor, resolveTarget, type FrameSize, DEFAULT_FRAME } from "../composition/intent";
import type { ShotSize } from "../composition/intent";
import type { Rect } from "../composition/types";
import type { ShotPlan } from "./types";

function solved(shotSize: string, yaw: number, frame: FrameSize): Pick<ShotPlan, "shotSize" | "eyeLine" | "horizontal" | "headroom" | "targetBox"> {
  const size: ShotSize = normalizeShotSize(shotSize);
  const target = resolveTarget({ shotSize: size, yaw }, frame.aspect);
  return {
    shotSize,
    eyeLine: target.eyeY,
    horizontal: target.horizontal,
    headroom: target.headroom,
    targetBox: placementFor(target, frame).subjectBox,
  };
}

function plan(
  partial: Omit<ShotPlan, "targetBox" | "eyeLine" | "horizontal" | "headroom" | "cameraAdvice" | "shotSize"> & {
    shotSize: string;
    yaw?: number;
    height: string;
    tilt: string;
    distance: string;
  },
  frame: FrameSize,
): ShotPlan {
  return {
    title: partial.title,
    styleTag: partial.styleTag,
    ...solved(partial.shotSize, partial.yaw ?? 0, frame),
    cameraAdvice: { height: partial.height, tilt: partial.tilt, distance: partial.distance },
    zoom: partial.zoom,
    poseTip: partial.poseTip,
    holderDirection: partial.holderDirection,
    confidence: partial.confidence,
  };
}

/** On-device plans. Boxes come from the spec solver, not from stored coordinates. */
export function fallbackPlans(style: string, subject: Rect | null, frame?: FrameSize): ShotPlan[] {
  const tag = style.trim() || "自然";
  const used = frame ?? DEFAULT_FRAME;
  const legs = /腿|全身|full/i.test(tag);
  const funny = /搞笑|滑稽|funny/i.test(tag);
  const mood = /氛围|胶片|mood|film/i.test(tag);
  const pretty = /唯美|柔|美|pretty|soft/i.test(tag);
  const seen = subject ? 0.02 : 0;
  const make = (
    partial: Omit<ShotPlan, "targetBox" | "eyeLine" | "horizontal" | "headroom" | "cameraAdvice" | "shotSize"> & {
      shotSize: string;
      yaw?: number;
      height: string;
      tilt: string;
      distance: string;
    },
  ) => plan(partial, used);

  if (legs) {
    return [
      make({
        title: "低机位拉长",
        styleTag: tag,
        shotSize: "full",
        height: "机位放到膝盖以下",
        tilt: "保持水平",
        distance: "退到能放下全身",
        zoom: 1,
        poseTip: "重心放在后腿，肩打开",
        holderDirection: "人站在画面中线，头顶留一点天",
        confidence: 0.62 + seen,
      }),
      make({
        title: "七分身",
        styleTag: tag,
        shotSize: "three-quarter",
        height: "机位略低于胸口",
        tilt: "保持水平",
        distance: "再退一步",
        zoom: 1.05,
        poseTip: "一条腿微曲",
        holderDirection: "切在大腿中段，不要切到膝盖",
        confidence: 0.58,
      }),
      make({
        title: "留白全身",
        styleTag: tag,
        shotSize: "environmental",
        yaw: 0.4,
        height: "与腰平",
        tilt: "保持水平",
        distance: "退远，让环境进来",
        zoom: 1,
        poseTip: "站直，手自然下垂",
        holderDirection: "人偏一侧，另一侧留给背景",
        confidence: 0.5,
      }),
    ];
  }

  if (funny) {
    return [
      make({
        title: "靠近抓表情",
        styleTag: tag,
        shotSize: "close",
        height: "略低于眼睛",
        tilt: "可以微微歪一下",
        distance: "走近半步",
        zoom: 1.25,
        poseTip: "做一个夸张但轻松的表情",
        holderDirection: "脸放在画面上半，别切到下巴",
        confidence: 0.6,
      }),
      make({
        title: "半身笑点",
        styleTag: tag,
        shotSize: "medium",
        yaw: 0.4,
        height: "与眼平",
        tilt: "保持水平",
        distance: "保持现在的距离",
        zoom: 1.1,
        poseTip: "手可以入画，动作做大一点",
        holderDirection: "人靠一侧，给手势留空",
        confidence: 0.55,
      }),
      make({
        title: "环境里的人",
        styleTag: tag,
        shotSize: "wide",
        yaw: 0.4,
        height: "略高一点俯视",
        tilt: "保持水平",
        distance: "后退，把周围一起带上",
        zoom: 1,
        poseTip: "和旁边的东西互动",
        holderDirection: "人不要顶满画面",
        confidence: 0.48,
      }),
    ];
  }

  const primary = mood
    ? make({
        title: "侧光留白",
        styleTag: tag,
        shotSize: "medium",
        yaw: 0.4,
        height: "与眼平或略低",
        tilt: "保持水平",
        distance: "保持，不要贴太近",
        zoom: 1.08,
        poseTip: "目光看向空的一侧，肩放松",
        holderDirection: "人放在三分线上，视线前面留空",
        confidence: 0.64,
      })
    : pretty
      ? make({
          title: "柔和半身",
          styleTag: tag,
          shotSize: "medium",
          height: "与眼平",
          tilt: "保持水平",
          distance: "再靠近一点点",
          zoom: 1.12,
          poseTip: "下巴微收，表情放轻",
          holderDirection: "眼睛靠近上三分线，头顶留白",
          confidence: 0.66,
        })
      : make({
          title: "干净半身",
          styleTag: tag,
          shotSize: "medium",
          height: "与眼平",
          tilt: "保持水平",
          distance: "走到胸口以上刚好",
          zoom: 1.1,
          poseTip: "肩放松，看向镜头",
          holderDirection: "人在中线，眼睛在上三分线附近",
          confidence: 0.6 + seen,
        });

  return [
    primary,
    make({
      title: "再紧一点",
      styleTag: tag,
      shotSize: "close",
      height: "与眼平",
      tilt: "保持水平",
      distance: "向前半步",
      zoom: 1.3,
      poseTip: "表情自然，不要耸肩",
      holderDirection: "脸完整，下巴下方留一点",
      confidence: 0.54,
    }),
    make({
      title: "带一点环境",
      styleTag: tag,
      shotSize: "wide",
      yaw: -0.4,
      height: "略低于眼睛",
      tilt: "保持水平",
      distance: "后退一步",
      zoom: 1,
      poseTip: "站直，手别贴着身体",
      holderDirection: "人偏一侧，背景留出线条",
      confidence: 0.5,
    }),
  ];
}
