export type BlendCategory = { categoryName?: string; score?: number };

/** Both eyes blinking. Missing blendshapes count as open so a still test face can capture. */
export function eyesClosedFromBlend(categories: BlendCategory[] | undefined, threshold = 0.55): boolean {
  if (!categories?.length) return false;
  const score = (name: string) => categories.find((item) => item.categoryName === name)?.score ?? 0;
  const left = score("eyeBlinkLeft");
  const right = score("eyeBlinkRight");
  if (left === 0 && right === 0) return false;
  return left > threshold && right > threshold;
}
