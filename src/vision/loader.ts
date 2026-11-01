type Scope = {
  importScripts?: (url: string) => void;
};

/**
 * Module workers have no importScripts. MediaPipe then calls `document.createElement`,
 * and an iOS Safari worker has no `document` ("Can't find variable: document").
 * Throwing TypeError is the signal MediaPipe already catches before it uses dynamic import().
 */
/** iOS Safari workers have no document, and desktop Safari module workers hit the same loader. */
export function prefersMainThread(userAgent: string): boolean {
  const safari = /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|FxiOS|OPiOS/i.test(userAgent);
  return /iP(hone|ad|od)/i.test(userAgent) || safari;
}

export function installImportScriptsShim(scope: Scope = globalThis as Scope): void {
  if (typeof scope.importScripts === "function") return;
  scope.importScripts = () => {
    throw new TypeError("dynamic import");
  };
}
