import { describe, expect, it } from "vitest";
import { PLANS_SYSTEM, buildPlansPrompt } from "../src/plans/prompt";
import { fallbackPlans } from "../src/plans/fallback";
import { repairPlans, repairPlansFromText } from "../src/plans/validate";

const context = {
  style: "氛围感",
  locale: "zh-CN",
  subjectBox: { x: 0.3, y: 0.2, w: 0.3, h: 0.4 },
};

describe("shot plan JSON", () => {
  it("repairs fenced model JSON into two to four plans", () => {
    const text = `Sure\n\`\`\`json\n{"plans":[
      {"title":"侧光","styleTag":"氛围感","shotSize":"medium","targetBox":{"x":-0.2,"y":0.1,"w":0.4,"h":1.4},"cameraAdvice":{"height":"与眼平","tilt":"保持水平","distance":"保持"},"zoom":4,"poseTip":"看向空处","holderDirection":"人放在左侧","confidence":1.4},
      {"title":"再紧","styleTag":"氛围感","shotSize":"close","targetBox":{"x":0.3,"y":0.15,"w":0.4,"h":0.35},"cameraAdvice":{"height":"与眼平","tilt":"水平","distance":"靠近"},"zoom":1.2,"poseTip":"放松","holderDirection":"脸完整","confidence":0.5},
      {"title":"坏的"},
      {"title":"五","styleTag":"x","shotSize":"wide","targetBox":{"x":0.2,"y":0.1,"w":0.3,"h":0.5},"cameraAdvice":{"height":"a","tilt":"b","distance":"c"},"zoom":1,"poseTip":"d","holderDirection":"e","confidence":0.4},
      {"title":"六","styleTag":"x","shotSize":"full","targetBox":{"x":0.2,"y":0.1,"w":0.3,"h":0.6},"cameraAdvice":{"height":"a","tilt":"b","distance":"c"},"zoom":1,"poseTip":"d","holderDirection":"e","confidence":0.4}
    ]}\n\`\`\``;
    const plans = repairPlansFromText(text, context);
    expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(plans.length).toBeLessThanOrEqual(4);
    expect(plans[0].targetBox.x).toBeGreaterThanOrEqual(0);
    expect(plans[0].targetBox.y + plans[0].targetBox.h).toBeLessThanOrEqual(1);
    expect(plans[0].zoom).toBeLessThanOrEqual(3);
    expect(plans[0].confidence).toBeLessThanOrEqual(1);
    expect(plans.some((plan) => plan.title === "坏的")).toBe(false);
  });

  it("ignores coordinate-only replies and solves the box from shot size", () => {
    const plans = repairPlans({ box: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 }, reasoning: "old" }, context);
    expect(plans.length).toBeGreaterThanOrEqual(2);
    const solved = repairPlans({ plans: [{ title: "干净半身", shotSize: "medium", targetBox: { x: 0, y: 0, w: 0.9, h: 0.9 } }] }, context);
    const clean = repairPlans({ plans: [{ title: "干净半身", shotSize: "medium" }] }, context);
    expect(solved[0].targetBox).toEqual(clean[0].targetBox);
    expect(plans[0].targetBox.w).toBeGreaterThan(0.1);
    expect(plans[0].targetBox.x).toBeGreaterThanOrEqual(0);
  });

  it("falls back when the model returns nothing usable", () => {
    const plans = repairPlansFromText("not json", context);
    expect(plans).toHaveLength(3);
    expect(plans[0].styleTag).toBe("氛围感");
  });

  it("asks the model for composition rules and the user's words", () => {
    expect(PLANS_SYSTEM).toMatch(/third/i);
    expect(PLANS_SYSTEM).toMatch(/joint/i);
    expect(PLANS_SYSTEM).toMatch(/head/i);
    expect(PLANS_SYSTEM).toMatch(/horizon/i);
    const prompt = buildPlansPrompt({
      style: "显腿长",
      locale: "zh-CN",
      aspect: "4:5",
      imageWidth: 1080,
      imageHeight: 1920,
      rollDeg: 2,
      zoom: { min: 1, max: 4, current: 1 },
      subject: { box: context.subjectBox },
    });
    expect(prompt).toContain("显腿长");
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("untrusted sensor data");
    expect(prompt).toContain("<subject>");
    expect(PLANS_SYSTEM).toMatch(/never|do not output/i);
    expect(fallbackPlans("显腿长", null)[0].shotSize).toBe("full");
  });
});
