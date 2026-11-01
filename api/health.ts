import { handleApi } from "../server/handle";

export default async function handler(request: any, response: any): Promise<void> {
  await send(request, response, await handleApi(await toRequest(request), process.env));
}

function header(request: any, name: string): string | undefined {
  const raw = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] == null ? undefined : String(raw[0]);
  if (raw == null) return undefined;
  return String(raw);
}

export async function toRequest(request: any): Promise<Request> {
  const method = request.method || "GET";
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") body = await readBody(request);
  const host = request.headers?.host || "localhost";
  const url = request.url?.startsWith("http") ? request.url : `https://${host}${request.url || "/"}`;
  const headers = new Headers();
  headers.set("content-type", header(request, "content-type") || "application/json");
  for (const name of ["origin", "x-real-ip", "x-vercel-forwarded-for", "content-length"]) {
    const value = header(request, name);
    if (value) headers.set(name, value);
  }
  return new Request(url, { method, headers, body });
}

async function readBody(request: any): Promise<string> {
  const max = 1_800_001;
  if (typeof request.body === "string") return request.body.length > max ? request.body.slice(0, max) : request.body;
  if (Buffer.isBuffer(request.body)) {
    const text = request.body.toString("utf8");
    return text.length > max ? text.slice(0, max) : text;
  }
  if (request.body && typeof request.body === "object" && !request[Symbol.asyncIterator]) return JSON.stringify(request.body);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    chunks.push(buf);
    if (total > max) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function send(request: any, response: any, result: Response): Promise<void> {
  response.statusCode = result.status;
  result.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await result.arrayBuffer()));
  void request;
}
