import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Security headers applied to every response. The CSP allows the app's own
 * code plus the Supabase project (API + storage) configured for this build.
 */
function securityHeaders() {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isDev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    // Next.js inlines small bootstrapping scripts; 'unsafe-eval' only in dev (React refresh).
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${supabase.replace(/^https:/, "wss:")}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // Geolocation is needed by the Time Clock (Phase 5); camera by photo capture (Phase 8).
    { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}

const nextConfig: NextConfig = {
  // Cache Components is intentionally OFF: every screen in this app is
  // per-user, so there is little to prerender, and it simplifies session
  // handling. Revisit when upgrading to the next major Next.js version.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default withNextIntl(nextConfig);
