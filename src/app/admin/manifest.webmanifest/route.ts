/**
 * Манифест веб-застосунку адмінки: «Додому» на iPhone відкриває /admin у повноекранному режимі.
 * Next підтримує `manifest.ts` лише в корені app, тому для підшляху /admin це окремий роут.
 * Публічний (без cookie): браузер запитує манифест анонімно; у ньому немає жодних даних.
 */
export const dynamic = "force-static";

const manifest = {
  id: "/admin",
  name: "BONSI Admin",
  short_name: "BONSI",
  description: "Статистика й посилання студії BONSI",
  start_url: "/admin",
  scope: "/admin",
  display: "standalone",
  orientation: "portrait",
  background_color: "#0e0e12",
  theme_color: "#0e0e12",
  lang: "uk",
  icons: [
    { src: "/admin/icon", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/admin/apple-icon", sizes: "180x180", type: "image/png" },
  ],
};

export function GET() {
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
