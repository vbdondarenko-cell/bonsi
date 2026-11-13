import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Приватні розділи не індексуються: /app і /admin закриті авторизацією,
      // /auth і /login — службові, /api — не сторінки.
      disallow: ["/api/", "/admin", "/app", "/auth/", "/login"],
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
