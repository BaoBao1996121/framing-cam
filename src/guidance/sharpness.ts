/** Variance of a 3x3 Laplacian. Sharp edges score higher than a flat frame. */
export function laplacianVariance(pixels: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const gray = (index: number) => pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const value =
        -4 * gray(index) +
        gray(index - 4) +
        gray(index + 4) +
        gray(index - width * 4) +
        gray(index + width * 4);
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export function pickSharpest<T extends { score: number }>(frames: T[]): T | null {
  if (!frames.length) return null;
  return frames.reduce((best, frame) => (frame.score > best.score ? frame : best));
}
