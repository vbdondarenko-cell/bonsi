import type { NextConfig } from "next";

// CSP: жорсткі директиви діють одразу; повна політика спершу в Report-Only (Next і GA використовують inline-скрипти,
// тож перехід на nonce-CSP робіть після перегляду звітів у консолі браузера).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com https://*.google.com https://*.doubleclick.net https://*.googleadservices.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.doubleclick.net https://www.googleadservices.com https://www.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // Keep standalone output and file tracing rooted in this app on machines with parent lockfiles.
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  reactStrictMode: true,
  // Для cPanel (Passenger) потрібен self-contained сервер: BUILD_STANDALONE=1 npm run build.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      // Додатковий захист від індексації приватних сторінок, навіть якщо robots.txt проігнорують.
      { source: "/admin/:path*", headers: noindex },
      { source: "/app/:path*", headers: noindex },
      { source: "/api/:path*", headers: noindex },
      { source: "/auth/:path*", headers: noindex },
      { source: "/login", headers: noindex },
    ];
  },
};

export default nextConfig;
