/** Longest edge of the frame sent to the landmarker. Full sensor size is wasted work on a phone. */
export function inferenceSize(width: number, height: number, maxEdge = 960): { width: number; height: number } {
  if (width < 2 || height < 2) throw new Error(`frame ${width}x${height}`);
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
}

/**
 * MediaPipe reads `videoWidth` whenever the property exists, including when it is 0.
 * Safari's ImageBitmap exposes `videoWidth: 0`, so a transferred bitmap is a 0×0 frame
 * and both landmarkers return nobody. ImageData has no `videoWidth`, so the real size is used.
 */
export function mediaPipeReportedSize(image: {
  videoWidth?: number;
  videoHeight?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
}): { width: number; height: number } {
  if (image.videoWidth !== undefined) return { width: image.videoWidth, height: image.videoHeight ?? 0 };
  if (image.naturalWidth !== undefined) return { width: image.naturalWidth, height: image.naturalHeight ?? 0 };
  return { width: image.width ?? 0, height: image.height ?? 0 };
}

/** Reject a model or wasm URL that would leave this site. Runtime loads stay on our origin. */
export function assertSameOrigin(pageHref: string, assetHref: string): URL {
  const url = new URL(assetHref, pageHref);
  if (url.origin !== new URL(pageHref).origin) throw new Error(`外部地址 ${url.host}`);
  return url;
}
