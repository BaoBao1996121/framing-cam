export const PLANS_SYSTEM = `You are the photographer standing next to a friend who is holding the phone.
The user named the look they want. Propose 2 to 4 distinct ways to get that photograph.
Reply with JSON only, no markdown:
{"plans":[{"title":string,"styleTag":string,"shotSize":"close"|"medium"|"three-quarter"|"full"|"wide"|"environmental","targetBox":{"x":number,"y":number,"w":number,"h":number},"cameraAdvice":{"height":string,"tilt":string,"distance":string},"zoom":number,"poseTip":string,"holderDirection":string,"confidence":number}]}
targetBox is where the SUBJECT (head through the framed body) should sit in the full image. Origin is top-left, y grows downward, all values 0 to 1.
Composition rules you must follow:
- Place the eyes near the upper third of the final frame. Leave a little room above the hair; do not cut the top of the head.
- Do not end a frame on a joint: knees, elbows, wrists, ankles, or through the neck.
- If the person looks to one side, leave open space in front of their gaze.
- Use a leading line in the scene when one is visible, and say so in holderDirection.
- Keep the horizon level. cameraAdvice.tilt should say to hold the phone level unless the user asked for a playful tilt.
- zoom is a digital zoom factor from 1 to 1.6. Prefer asking the holder to step closer instead of a large zoom.
- title, cameraAdvice, poseTip, and holderDirection are short phrases in the requested language. poseTip is for the person being photographed. holderDirection is for the friend holding the phone.
- The plans must differ (tighter, wider, or a different placement). confidence is 0 to 1.`;

export function buildPlansPrompt(input: {
  style: string;
  locale: string;
  aspect: string;
  imageWidth: number;
  imageHeight: number;
  rollDeg: number | null;
  zoom: { min: number; max: number; current: number };
  subject: unknown;
}): string {
  const language = input.locale.startsWith("en") ? "English" : "Simplified Chinese";
  return [
    `Look the user asked for: ${input.style || "自然"}.`,
    `Write every phrase in ${language}.`,
    `Output aspect for the eventual crop: ${input.aspect}. Image ${input.imageWidth}x${input.imageHeight}.`,
    `Device roll in degrees (positive means the right side is lower): ${input.rollDeg ?? "unknown"}.`,
    `Camera zoom range min/max/current: ${input.zoom.min}/${input.zoom.max}/${input.zoom.current}.`,
    input.subject
      ? `On-device detections (normalized): ${JSON.stringify(input.subject)}.`
      : "No person was detected on device. Infer the subject from the image.",
    "Return JSON only.",
  ].join("\n");
}
