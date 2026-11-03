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
  // pdfkit читає власні файли даних з диска; бандлінг їх ламає.
  serverExternalPackages: ["pdfkit"],
  // Шрифти для PDF читаються з диска під час виконання; на серверлес-хостингу їх треба явно додати до пакета.
  outputFileTracingIncludes: { "/**/pdf": ["./assets/fonts/**/*"] },
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
