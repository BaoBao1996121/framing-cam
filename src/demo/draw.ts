import { subjectFromDemo, type DemoState, DEMO_HEIGHT, DEMO_WIDTH } from "./person";

export function drawDemo(context: CanvasRenderingContext2D, state: DemoState): void {
  const width = DEMO_WIDTH;
  const height = DEMO_HEIGHT;
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#e4d3b8");
  sky.addColorStop(0.58, "#c9b292");
  sky.addColorStop(0.58, "#8b7358");
  sky.addColorStop(1, "#6a5643");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#f4ecdf";
  context.fillRect(width * 0.66, height * 0.1, width * 0.22, height * 0.24);
  context.strokeStyle = "#8d6f4e";
  context.lineWidth = 10;
  context.strokeRect(width * 0.66, height * 0.1, width * 0.22, height * 0.24);
  context.beginPath();
  context.moveTo(width * 0.77, height * 0.1);
  context.lineTo(width * 0.77, height * 0.34);
  context.moveTo(width * 0.66, height * 0.22);
  context.lineTo(width * 0.88, height * 0.22);
  context.stroke();

  context.save();
  context.translate(width / 2, height * 0.58);
  context.rotate((state.roll * Math.PI) / 180);
  context.strokeStyle = "rgba(70, 48, 28, 0.45)";
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(-width, 0);
  context.lineTo(width, 0);
  context.stroke();
  context.restore();

  const subject = subjectFromDemo(state);
  const xOf = (value: number) => value * width;
  const yOf = (value: number) => value * height;
  const joint = (name: "elbow" | "wrist" | "hip" | "knee" | "ankle", side: "left" | "right") => {
    const rows = subject.joints.filter((item) => item.name === name).sort((a, b) => a.x - b.x);
    return side === "left" ? rows[0] : rows[1];
  };
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#2a241c";
  context.lineWidth = 26;
  const strokes: Array<[number, number, number, number]> = [];
  const leftShoulder = subject.shoulders[0];
  const rightShoulder = subject.shoulders[1];
  const leftHip = joint("hip", "left");
  const rightHip = joint("hip", "right");
  if (leftShoulder && rightShoulder && leftHip && rightHip) {
    strokes.push([leftShoulder.x, leftShoulder.y, rightShoulder.x, rightShoulder.y]);
    strokes.push([
      (leftShoulder.x + rightShoulder.x) / 2,
      subject.shouldersY ?? leftShoulder.y,
      (leftHip.x + rightHip.x) / 2,
      (leftHip.y + rightHip.y) / 2,
    ]);
    strokes.push([leftHip.x, leftHip.y, rightHip.x, rightHip.y]);
  }
  for (const name of ["elbow", "wrist", "knee", "ankle"] as const) {
    const left = joint(name, "left");
    const right = joint(name, "right");
    const anchorLeft = name === "elbow" || name === "wrist" ? leftShoulder : leftHip;
    const anchorRight = name === "elbow" || name === "wrist" ? rightShoulder : rightHip;
    const fromName = name === "wrist" ? "elbow" : name === "ankle" ? "knee" : null;
    const fromLeft = fromName ? joint(fromName, "left") : anchorLeft;
    const fromRight = fromName ? joint(fromName, "right") : anchorRight;
    if (left && fromLeft) strokes.push([fromLeft.x, fromLeft.y, left.x, left.y]);
    if (right && fromRight) strokes.push([fromRight.x, fromRight.y, right.x, right.y]);
  }
  for (const [x1, y1, x2, y2] of strokes) {
    context.beginPath();
    context.moveTo(xOf(x1), yOf(y1));
    context.lineTo(xOf(x2), yOf(y2));
    context.stroke();
  }

  const headCx = xOf(subject.eye.x);
  const headCy = yOf((subject.headTop + subject.chinY) / 2);
  const headRx = Math.abs(xOf(subject.headRight) - headCx);
  const headRy = Math.abs(yOf(subject.chinY) - yOf(subject.headTop)) / 2;
  context.fillStyle = "#efc2a4";
  context.beginPath();
  context.ellipse(headCx, headCy, Math.max(8, headRx), Math.max(8, headRy), 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#243028";
  const headSpan = subject.chinY - subject.headTop;
  context.beginPath();
  context.ellipse(xOf(subject.eye.x - headSpan * 0.12), yOf(subject.eye.y), 7, 8, 0, 0, Math.PI * 2);
  context.ellipse(xOf(subject.eye.x + headSpan * 0.12), yOf(subject.eye.y), 7, 8, 0, 0, Math.PI * 2);
  context.fill();
}
