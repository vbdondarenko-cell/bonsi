import { describe, expect, it } from "vitest";
import {
  attributionFromParams,
  attributionFromReferrer,
  cleanLinkCode,
  cleanPath,
  cleanToken,
  hostOf,
  isBot,
  parseDevice,
} from "./attribution";

describe("cleanToken", () => {
  it("нормалізує регістр, пробіли й зайві символи", () => {
    expect(cleanToken("  Spring Sale!! ")).toBe("spring-sale");
    expect(cleanToken("Instagram_Ads")).toBe("instagram_ads");
  });
  it("повертає null для порожніх і не-рядків", () => {
    expect(cleanToken("")).toBeNull();
    expect(cleanToken("!!!")).toBeNull();
    expect(cleanToken(42)).toBeNull();
  });
  it("обрізає за довжиною", () => {
    expect(cleanToken("a".repeat(100), 10)).toHaveLength(10);
  });
});

describe("cleanLinkCode", () => {
  it("приймає коректні коди", () => {
    expect(cleanLinkCode("sticker-kyiv-1")).toBe("sticker-kyiv-1");
    expect(cleanLinkCode("AB1")).toBe("ab1");
  });
  it("відхиляє некоректні", () => {
    expect(cleanLinkCode("a")).toBeNull();
    expect(cleanLinkCode("-abc")).toBeNull();
    expect(cleanLinkCode("abc-")).toBeNull();
    expect(cleanLinkCode("a b c")).toBeNull();
    expect(cleanLinkCode("../etc")).toBeNull();
  });
});

describe("attributionFromReferrer", () => {
  it("розпізнає пошук і соцмережі", () => {
    expect(attributionFromReferrer("google.com.ua", "bonsi.site")).toEqual({ source: "google", medium: "organic" });
    expect(attributionFromReferrer("l.instagram.com", "bonsi.site")).toEqual({ source: "instagram", medium: "social" });
    expect(attributionFromReferrer("t.me", "bonsi.site")).toEqual({ source: "telegram", medium: "social" });
  });
  it("невідомий хост стає referral", () => {
    expect(attributionFromReferrer("blog.example.com", "bonsi.site")).toEqual({
      source: "blog.example.com",
      medium: "referral",
    });
  });
  it("власний хост і порожній реферер — це прямий захід", () => {
    expect(attributionFromReferrer("bonsi.site", "bonsi.site")).toBeNull();
    expect(attributionFromReferrer("www.bonsi.site", "bonsi.site")).toBeNull();
    expect(attributionFromReferrer(null, "bonsi.site")).toBeNull();
  });
});

describe("attributionFromParams", () => {
  it("читає utm_* та код посилання", () => {
    const params = new URLSearchParams("utm_source=Instagram&utm_medium=cpc&utm_campaign=Spring&utm_content=Story-1&lc=ad-spring");
    expect(attributionFromParams(params)).toEqual({
      source: "instagram",
      medium: "cpc",
      campaign: "spring",
      content: "story-1",
      linkCode: "ad-spring",
    });
  });
  it("без utm і lc нічого не повертає", () => {
    expect(attributionFromParams(new URLSearchParams("a=1"))).toBeNull();
  });
  it("лише код посилання теж дає джерело", () => {
    expect(attributionFromParams(new URLSearchParams("lc=sticker-1"))).toMatchObject({
      source: "link",
      linkCode: "sticker-1",
    });
  });
});

describe("hostOf / cleanPath", () => {
  it("витягує хост без www", () => {
    expect(hostOf("https://www.Google.com/search?q=1")).toBe("google.com");
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
  it("залишає лише шлях", () => {
    expect(cleanPath("/pricing?x=1#a")).toBe("/pricing");
    expect(cleanPath("//evil.com")).toBeNull();
    expect(cleanPath("pricing")).toBeNull();
    expect(cleanPath("/a b")).toBeNull();
  });
});

describe("parseDevice / isBot", () => {
  it("визначає тип пристрою", () => {
    expect(parseDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148")).toBe("mobile");
    expect(parseDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit")).toBe("tablet");
    expect(parseDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36")).toBe("desktop");
  });
  it("відсікає ботів і превʼю посилань", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36")).toBe(false);
  });
});
