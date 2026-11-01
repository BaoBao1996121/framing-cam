import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { loadEnv, type Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function apiPlugin(): Plugin {
  return {
    name: "framing-api",
    configureServer(server) {
      const fileEnv = loadEnv(server.config.mode, server.config.root, "");
      server.middlewares.use(async (request, response, next) => {
        const url = request.url || "";
        if (!url.startsWith("/api/")) return next();
        try {
          const mod = (await server.ssrLoadModule("/server/handle.ts")) as {
            handleApi: (request: Request, env: Record<string, string | undefined>) => Promise<Response>;
          };
          const method = request.method || "GET";
          const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request);
          const incoming = new Request(new URL(url, "http://local"), {
            method,
            headers: { "content-type": String(request.headers["content-type"] || "") },
            body,
          });
          const result = await mod.handleApi(incoming, { ...fileEnv, ...process.env });
          response.statusCode = result.status;
          result.headers.forEach((value, key) => response.setHeader(key, value));
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch (error) {
          console.error(error);
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: false, error: "server_error" }));
        }
        void (response as ServerResponse);
      });
    },
  };
}

const certificate =
  process.env.HTTPS_KEY && process.env.HTTPS_CERT
    ? { key: readFileSync(process.env.HTTPS_KEY), cert: readFileSync(process.env.HTTPS_CERT) }
    : undefined;

function normalizeBase(value: string | undefined): string {
  const raw = (value || "/").trim();
  if (raw === "./" || raw === ".") return "./";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

const base = normalizeBase(process.env.VITE_BASE);

function redirectToBase(): Plugin {
  const send = (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
    const url = request.url || "/";
    if (url === "/" || url.startsWith("/?")) {
      response.statusCode = 302;
      response.setHeader("Location", `${base}${url.slice(1)}`);
      response.end();
      return;
    }
    next();
  };
  return {
    name: "redirect-to-base",
    configureServer(server) {
      server.middlewares.use(send);
    },
    configurePreviewServer(server) {
      server.middlewares.use(send);
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    ...(base !== "/" ? [redirectToBase()] : []),
    apiPlugin(),
    ...(process.env.HTTPS === "1" && !certificate ? [basicSsl()] : []),
  ],
  server: { host: true, port: 5173, https: certificate },
  preview: { host: true, port: 4173, https: certificate },
  optimizeDeps: { exclude: ["@mediapipe/tasks-vision"] },
  worker: { format: "es" },
});
