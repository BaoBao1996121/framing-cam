/** Selfie multiclass: hair and face-skin. Other classes are not the crown. */
export const HAIR_CLASS = 1;
export const FACE_SKIN_CLASS = 3;

/**
 * Highest hair or face-skin pixel inside the face's x range, as a fraction of the mask height.
 * Returns null when the mask has no head in that span.
 */
export function headTopFromCategoryMask(
  data: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  hair = HAIR_CLASS,
  faceSkin = FACE_SKIN_CLASS,
): number | null {
  if (width < 2 || height < 2 || data.length < width * height) return null;
  const left = Math.max(0, Math.floor(Math.min(x0, x1) * width));
  const right = Math.min(width - 1, Math.ceil(Math.max(x0, x1) * width));
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = left; x <= right; x += 1) {
      const value = data[row + x];
      if (value === hair || value === faceSkin) return y / height;
    }
  }
  return null;
}

/** Face landmark 10 minus k times the chin-to-forehead length. k is the calibrated fallback. */
export function headTopFromFace(faceTop: number, chin: number, k: number): number {
  return faceTop - k * Math.max(0, chin - faceTop);
}
