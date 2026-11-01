import { handleApi } from "../server/handle";

export default async function handler(request: any, response: any): Promise<void> {
  await send(request, response, await handleApi(await toRequest(request), process.env));
}

export async function toRequest(request: any): Promise<Request> {
  const method = request.method || "GET";
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") body = await readBody(request);
  const host = request.headers?.host || "localhost";
  const url = request.url?.startsWith("http") ? request.url : `https://${host}${request.url || "/"}`;
  return new Request(url, {
    method,
    headers: { "content-type": String(request.headers?.["content-type"] || "application/json") },
    body,
  });
}

async function readBody(request: any): Promise<string> {
  if (typeof request.body === "string") return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString("utf8");
  if (request.body && typeof request.body === "object") return JSON.stringify(request.body);
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function send(request: any, response: any, result: Response): Promise<void> {
  response.statusCode = result.status;
  result.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await result.arrayBuffer()));
  void request;
}
