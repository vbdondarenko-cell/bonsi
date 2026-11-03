import type { MetadataRoute } from "next";
import { listPublishedCases } from "@/lib/portfolio";
import { site } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const cases = await listPublishedCases();
  const pages = ["", "/services", "/portfolio", "/about", "/process", "/faq", "/contact", "/privacy", "/terms", "/cooperation"].map((path) => ({
    url: `${site.url}${path}`,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
  const caseUrls = cases.map((item) => ({
    url: `${site.url}/portfolio/${item.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  return [...pages, ...caseUrls];
}
