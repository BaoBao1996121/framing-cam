export function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

export function text(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

export function press(id: string, on: boolean, label: string): void {
  const button = document.getElementById(id);
  if (!button) return;
  button.setAttribute("aria-pressed", String(on));
  button.textContent = label;
}
