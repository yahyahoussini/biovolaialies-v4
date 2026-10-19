import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the workspace root to this project. Without it, Turbopack walks up looking for a
  // lockfile and picks up an unrelated package-lock.json in the user's home directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // The demo snapshot is opened through a runtime-built path (data/db/client.ts), which file
  // tracing cannot follow, so on Vercel it would simply be absent from the function bundle.
  // Force it in for every server route. Both keys because these are picomatch globs and `*`
  // does not cross `/`: `/*` covers top-level routes, `/**` the nested ones like /lots/[lotId].
  outputFileTracingIncludes: {
    "/*": ["./data/demo/snapshot.db.gz"],
    "/**": ["./data/demo/snapshot.db.gz"],
  },
  // The client's site draft (bvu_tech_site.py, after_request) sets these on every response.
  // Same policy here, except that scripts need 'unsafe-inline': Next.js bootstraps each page
  // with inline scripts, and nonces would force every page, static ones included, to render
  // per request. Nothing is loaded from another origin (next/font self-hosts Inter).
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

const isDev = process.env.NODE_ENV === "development";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self), not the draft's camera=(): the field app scans lot labels with the camera.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

export default nextConfig;
