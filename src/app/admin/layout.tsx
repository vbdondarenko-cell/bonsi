import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "Адмінпанель", template: "%s · Адмінпанель BONSI" },
  robots: { index: false, follow: false },
  applicationName: "BONSI Admin",
  manifest: "/admin/manifest.webmanifest",
  // iPhone: «Додому» відкриває адмінку як окремий застосунок із напівпрозорим рядком стану.
  appleWebApp: { capable: true, title: "BONSI Admin", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0e0e12",
  viewportFit: "cover",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
