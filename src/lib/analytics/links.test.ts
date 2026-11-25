import { describe, expect, it } from "vitest";
import { linkInput, shortUrl, slugify, utmUrl } from "./links";

describe("slugify", () => {
  it("транслітерує кирилицю й чистить символи", () => {
    expect(slugify("Стікер: Київ, метро!")).toBe("stiker-kyiv-metro");
    expect(slugify("  Instagram  Реклама 2026 ")).toBe("instagram-reklama-2026");
  });
  it("обрізає за довжиною без дефіса на кінці", () => {
    const slug = slugify("a".repeat(30) + " " + "b".repeat(30), 31);
    expect(slug.length).toBeLessThanOrEqual(31);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("linkInput", () => {
  const valid = {
    name: "Стікер у кав'ярні",
    code: "sticker-cafe-1",
    destination: "/pricing",
    source: "sticker",
    medium: "qr",
    campaign: "cafe-spring",
    content: "",
    note: "",
  };

  it("приймає коректні дані", () => {
    expect(linkInput.safeParse(valid).success).toBe(true);
  });
  it("відхиляє сторонній шлях (захист від відкритого редиректа)", () => {
    expect(linkInput.safeParse({ ...valid, destination: "https://evil.com" }).success).toBe(false);
    expect(linkInput.safeParse({ ...valid, destination: "//evil.com" }).success).toBe(false);
  });
  it("відхиляє некоректний код і токени", () => {
    expect(linkInput.safeParse({ ...valid, code: "A B" }).success).toBe(false);
    expect(linkInput.safeParse({ ...valid, source: "ins ta" }).success).toBe(false);
  });
});

describe("shortUrl / utmUrl", () => {
  it("будує короткий лінк без подвійного слеша", () => {
    expect(shortUrl("https://bonsi.site/", "ad-1")).toBe("https://bonsi.site/go/ad-1");
  });
  it("будує UTM-посилання з усіма мітками", () => {
    const url = new URL(
      utmUrl("https://bonsi.site", {
        destination: "/pricing",
        source: "instagram",
        medium: "cpc",
        campaign: "spring",
        content: null,
        code: "ad-1",
      }),
    );
    expect(url.pathname).toBe("/pricing");
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
    expect(url.searchParams.get("utm_campaign")).toBe("spring");
    expect(url.searchParams.has("utm_content")).toBe(false);
    expect(url.searchParams.get("lc")).toBe("ad-1");
  });
});
