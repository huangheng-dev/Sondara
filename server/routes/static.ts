import type { FastifyPluginAsync } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

export const staticRoutes: FastifyPluginAsync<{ distDir: string }> = async (
  app,
  opts,
) => {
  const distDir = opts.distDir;

  // Serve /assets/* and other static files
  app.get<{ Params: { "*": string } }>("/*", async (request, reply) => {
    const requestPath = request.params["*"];

    // Let API 404s return JSON instead of SPA fallback
    if (requestPath.startsWith("api/")) {
      return reply.code(404).send({ error: "NOT_FOUND", message: "接口不存在。" });
    }

    // Block path traversal
    const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(distDir, safePath);

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const mime = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
      reply.header("Content-Type", mime);
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.send(createReadStream(filePath));
    }

    // SPA fallback: serve index.html for non-API, non-file routes
    const indexPath = join(distDir, "index.html");
    if (existsSync(indexPath)) {
      reply.header("Content-Type", "text/html; charset=utf-8");
      reply.header("Cache-Control", "no-cache");
      return reply.send(createReadStream(indexPath));
    }

    return reply.code(404).send({ error: "NOT_FOUND" });
  });
};
