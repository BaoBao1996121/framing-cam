import { portraitTargets } from "./targets";
import type { JointName, Point, Subject } from "./types";

export type RawPoint = { x: number; y: number; visibility?: number };

export type RawFace = {
  forehead: RawPoint;
  chin: RawPoint;
  leftEye: RawPoint;
  rightEye: RawPoint;
  nose: RawPoint;
  leftCheek: RawPoint;
  rightCheek: RawPoint;
  score?: number;
};

export type RawPose = {
  landmarks: RawPoint[];
  score?: number;
};

export const POSE = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const VISIBLE = portraitTargets.landmarks.minVisibility;

export function headHeight(subject: Subject): number {
  return Math.max(0.001, subject.chinY - subject.headTop);
}

/** The region we compare with a plan's target box: hair through the upper body. */
export function subjectRegion(subject: Subject): { x: number; y: number; w: number; h: number } {
  const head = headHeight(subject);
  const bottom = subject.shouldersY != null ? subject.shouldersY + head * 1.15 : subject.chinY + head * 0.85;
  const xs = [subject.headLeft, subject.headRight, ...subject.shoulders.map((point) => point.x)];
  const x = Math.max(0, Math.min(1, Math.min(...xs)));
  const right = Math.max(0, Math.min(1, Math.max(...xs)));
  const y = Math.max(0, Math.min(0.92, subject.headTop));
  const h = Math.max(0.08, Math.min(1 - y, bottom - y));
  const w = Math.max(0.08, Math.min(1 - x, right - x));
  return { x, y, w, h };
}

function usable(point: RawPoint | undefined): point is RawPoint {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (point.visibility != null && point.visibility < VISIBLE) return false;
  return true;
}

function avgPoint(points: RawPoint[]): Point | null {
  const ok = points.filter(usable);
  if (!ok.length) return null;
  return {
    x: ok.reduce((sum, point) => sum + point.x, 0) / ok.length,
    y: ok.reduce((sum, point) => sum + point.y, 0) / ok.length,
  };
}

function pushJoint(
  joints: Subject["joints"],
  name: JointName,
  point: RawPoint | undefined,
): void {
  if (!usable(point)) return;
  joints.push({ name, x: point.x, y: point.y });
}

export function subjectFromFaceAndPose(face: RawFace | null, pose: RawPose | null): Omit<Subject, "id"> | null {
  const landmarks = pose?.landmarks ?? [];
  const joints: Subject["joints"] = [];
  pushJoint(joints, "elbow", landmarks[POSE.leftElbow]);
  pushJoint(joints, "elbow", landmarks[POSE.rightElbow]);
  pushJoint(joints, "wrist", landmarks[POSE.leftWrist]);
  pushJoint(joints, "wrist", landmarks[POSE.rightWrist]);
  pushJoint(joints, "hip", landmarks[POSE.leftHip]);
  pushJoint(joints, "hip", landmarks[POSE.rightHip]);
  pushJoint(joints, "knee", landmarks[POSE.leftKnee]);
  pushJoint(joints, "knee", landmarks[POSE.rightKnee]);
  pushJoint(joints, "ankle", landmarks[POSE.leftAnkle]);
  pushJoint(joints, "ankle", landmarks[POSE.rightAnkle]);

  const shoulderPoints = [landmarks[POSE.leftShoulder], landmarks[POSE.rightShoulder]].filter(usable);
  const shoulders = shoulderPoints.map((point) => ({ x: point.x, y: point.y }));
  const shouldersY = shoulders.length
    ? shoulders.reduce((sum, point) => sum + point.y, 0) / shoulders.length
    : null;

  if (face) {
    const eyeX = (face.leftEye.x + face.rightEye.x) / 2;
    const eyeY = (face.leftEye.y + face.rightEye.y) / 2;
    const iod = Math.abs(face.rightEye.x - face.leftEye.x);
    const faceH = Math.max(0.02, face.chin.y - face.forehead.y);
    const yaw = iod > 0.008 ? (face.nose.x - eyeX) / iod : 0;
    return {
      eye: { x: eyeX, y: eyeY },
      headTop: face.forehead.y - faceH * portraitTargets.landmarks.headTopFromFace.faceTopMinusChinToFaceTopRatio,
      chinY: face.chin.y,
      headLeft: Math.min(face.leftCheek.x, face.leftEye.x, face.rightEye.x),
      headRight: Math.max(face.rightCheek.x, face.leftEye.x, face.rightEye.x),
      yaw,
      shouldersY,
      shoulders,
      joints,
      confidence: face.score ?? pose?.score ?? 0.8,
    };
  }

  if (!pose) return null;
  const leftEye = landmarks[POSE.leftEye];
  const rightEye = landmarks[POSE.rightEye];
  const nose = landmarks[POSE.nose];
  const ears = avgPoint([landmarks[POSE.leftEar], landmarks[POSE.rightEar]]);
  const eyes = avgPoint([leftEye, rightEye]);
  const eye = eyes ?? (usable(nose) ? { x: nose.x, y: nose.y } : null);
  if (!eye) return null;
  const iod = usable(leftEye) && usable(rightEye)
    ? Math.abs(rightEye.x - leftEye.x)
    : ears
      ? Math.abs((landmarks[POSE.rightEar]?.x ?? eye.x) - (landmarks[POSE.leftEar]?.x ?? eye.x)) * 0.55
      : 0.06;
  const scale = Math.max(0.03, iod);
  const yaw = usable(leftEye) && usable(rightEye) && usable(nose) && iod > 0.008
    ? (nose.x - eye.x) / iod
    : 0;
  const half = Math.max(scale * 1.15, ears ? Math.abs(eye.x - ears.x) + scale : scale);
  return {
    eye,
    headTop: eye.y - scale * 1.35,
    chinY: eye.y + scale * 1.15,
    headLeft: eye.x - half,
    headRight: eye.x + half,
    yaw,
    shouldersY,
    shoulders,
    joints,
    confidence: pose.score ?? 0.6,
  };
}

export function detectSubjects(faces: RawFace[], poses: RawPose[]): Omit<Subject, "id">[] {
  const used = new Set<number>();
  const found: Omit<Subject, "id">[] = [];
  for (const face of faces) {
    const faceX = (face.leftEye.x + face.rightEye.x) / 2;
    const faceY = (face.leftEye.y + face.rightEye.y) / 2;
    let best = -1;
    let bestDistance = 0.2;
    for (let index = 0; index < poses.length; index += 1) {
      if (used.has(index)) continue;
      const nose = poses[index].landmarks[POSE.nose];
      if (!usable(nose)) continue;
      const distance = Math.hypot(nose.x - faceX, nose.y - faceY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    if (best >= 0) used.add(best);
    const subject = subjectFromFaceAndPose(face, best >= 0 ? poses[best] : null);
    if (subject) found.push(subject);
  }
  for (let index = 0; index < poses.length; index += 1) {
    if (used.has(index)) continue;
    const subject = subjectFromFaceAndPose(null, poses[index]);
    if (subject) found.push(subject);
  }
  return found;
}

export type TrackPoint = { id: string; x: number; y: number };

export function assignIds(
  previous: TrackPoint[],
  found: Omit<Subject, "id">[],
  sequence: { n: number },
): { subjects: Subject[]; tracks: TrackPoint[] } {
  const used = new Set<number>();
  const subjects: Subject[] = [];
  const tracks: TrackPoint[] = [];
  for (const detection of found) {
    let best = -1;
    let bestDistance = 0.16;
    for (let index = 0; index < previous.length; index += 1) {
      if (used.has(index)) continue;
      const distance = Math.hypot(previous[index].x - detection.eye.x, previous[index].y - detection.eye.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    const id = best >= 0 ? previous[best].id : `p${(sequence.n += 1)}`;
    if (best >= 0) used.add(best);
    subjects.push({ ...detection, id });
    tracks.push({ id, x: detection.eye.x, y: detection.eye.y });
  }
  return { subjects, tracks };
}

export function selectSubject(subjects: Subject[], selectedId: string | null): Subject | null {
  if (!subjects.length) return null;
  if (selectedId) {
    const selected = subjects.find((subject) => subject.id === selectedId);
    if (selected) return selected;
  }
  return [...subjects].sort((a, b) => headHeight(b) - headHeight(a))[0];
}

function mix(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function mixPoint(from: Point, to: Point, alpha: number): Point {
  return { x: mix(from.x, to.x, alpha), y: mix(from.y, to.y, alpha) };
}

export function smoothSubject(previous: Subject | null, next: Subject, alpha = 0.42): Subject {
  if (!previous || previous.id !== next.id) return next;
  if (Math.hypot(previous.eye.x - next.eye.x, previous.eye.y - next.eye.y) > 0.18) return next;
  const joints = next.joints.map((joint) => {
    let nearest: Subject["joints"][number] | null = null;
    let nearestDistance = 0.08;
    for (const prior of previous.joints) {
      if (prior.name !== joint.name) continue;
      const distance = Math.hypot(prior.x - joint.x, prior.y - joint.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = prior;
      }
    }
    return nearest ? { ...joint, x: mix(nearest.x, joint.x, alpha), y: mix(nearest.y, joint.y, alpha) } : joint;
  });
  return {
    ...next,
    eye: mixPoint(previous.eye, next.eye, alpha),
    headTop: mix(previous.headTop, next.headTop, alpha),
    chinY: mix(previous.chinY, next.chinY, alpha),
    headLeft: mix(previous.headLeft, next.headLeft, alpha),
    headRight: mix(previous.headRight, next.headRight, alpha),
    yaw: mix(previous.yaw, next.yaw, alpha),
    shouldersY:
      previous.shouldersY == null || next.shouldersY == null
        ? next.shouldersY
        : mix(previous.shouldersY, next.shouldersY, alpha),
    shoulders: next.shoulders.map((point, index) => {
      const prior = previous.shoulders[index];
      return prior ? mixPoint(prior, point, alpha) : point;
    }),
    joints,
  };
}
