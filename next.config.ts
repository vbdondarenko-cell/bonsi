import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
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
