import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function font(file: string) {
  return readFile(path.join(process.cwd(), "node_modules/@fontsource/onest/files", file));
}

export default async function OpenGraphImage() {
  const [cyr, lat] = await Promise.all([
    font("onest-cyrillic-600-normal.woff"),
    font("onest-latin-600-normal.woff"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          backgroundColor: "#0e0e12",
          backgroundImage: "radial-gradient(circle at 85% 0%, rgba(108,76,245,0.45), rgba(14,14,18,0) 60%)",
          color: "#f4f4f7",
          fontFamily: "Onest",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, letterSpacing: 10, fontWeight: 600 }}>
          BONSI<span style={{ color: "#9b82ff" }}>.</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 84, lineHeight: 1.05, fontWeight: 600, letterSpacing: -2 }}>
            <span>Створюємо цифрові продукти, які&nbsp;</span>
            <span style={{ color: "#9b82ff" }}>працюють</span>
          </div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#a3a3b5", fontWeight: 600 }}>
            Сайти · Вебплатформи · Мобільні додатки
          </div>
        </div>
        <div style={{ display: "flex", height: 4, width: 160, background: "#6c4cf5", borderRadius: 2 }} />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Onest", data: cyr, weight: 600, style: "normal" },
        { name: "Onest", data: lat, weight: 600, style: "normal" },
      ],
    },
  );
}
