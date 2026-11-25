import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Іконка для «Додому» на iPhone: iOS сам заокруглює кути, тож фон суцільний. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0e0e12",
          color: "#6c4cf5",
          fontSize: 120,
          fontWeight: 800,
        }}
      >
        B
      </div>
    ),
    size,
  );
}
