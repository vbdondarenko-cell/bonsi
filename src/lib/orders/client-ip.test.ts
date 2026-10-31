import { describe, expect, it } from "vitest";
import { getClientIp, ipBucket, parseTrustedProxy } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("parseTrustedProxy", () => {
  it("за замовчуванням нікому не довіряє, а на Vercel довіряє Vercel", () => {
    expect(parseTrustedProxy(undefined, {})).toEqual({ kind: "none" });
    expect(parseTrustedProxy("", {})).toEqual({ kind: "none" });
    expect(parseTrustedProxy(undefined, { VERCEL: "1" })).toEqual({ kind: "vercel" });
  });

  it("розбирає явні режими", () => {
    expect(parseTrustedProxy("NONE", {})).toEqual({ kind: "none" });
    expect(parseTrustedProxy("cloudflare", {})).toEqual({ kind: "cloudflare" });
    expect(parseTrustedProxy("hops:2", {})).toEqual({ kind: "hops", count: 2 });
  });

  it("відхиляє некоректні значення замість мовчазного ослаблення захисту", () => {
    expect(() => parseTrustedProxy("hops:0", {})).toThrow();
    expect(() => parseTrustedProxy("trust-everything", {})).toThrow();
  });
});

describe("getClientIp: захист від підміни", () => {
  const spoofed = h({
    "x-forwarded-for": "6.6.6.6, 203.0.113.9",
    "x-real-ip": "7.7.7.7",
    "cf-connecting-ip": "8.8.8.8",
  });

  it("none ігнорує будь-які заголовки", () => {
    expect(getClientIp(spoofed, { kind: "none" })).toBeNull();
  });

  it("hops:1 бере адресу, додану довіреним проксі, а не підроблену першу", () => {
    expect(getClientIp(spoofed, { kind: "hops", count: 1 })).toBe("203.0.113.9");
  });

  it("hops:2 бере другий елемент з кінця", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.0.0.1" });
    expect(getClientIp(headers, { kind: "hops", count: 2 })).toBe("198.51.100.4");
  });

  it("hops повертає null, якщо ланцюжок коротший за кількість довірених проксі", () => {
    expect(getClientIp(h({ "x-forwarded-for": "6.6.6.6" }), { kind: "hops", count: 2 })).toBeNull();
    expect(getClientIp(h({}), { kind: "hops", count: 1 })).toBeNull();
  });

  it("vercel надає перевагу x-vercel-forwarded-for і не читає cf-connecting-ip", () => {
    const headers = h({ "x-vercel-forwarded-for": "198.51.100.7", "cf-connecting-ip": "8.8.8.8" });
    expect(getClientIp(headers, { kind: "vercel" })).toBe("198.51.100.7");
    expect(getClientIp(h({ "cf-connecting-ip": "8.8.8.8" }), { kind: "vercel" })).toBeNull();
  });

  it("cloudflare читає лише cf-connecting-ip", () => {
    expect(getClientIp(spoofed, { kind: "cloudflare" })).toBe("8.8.8.8");
    expect(getClientIp(h({ "x-forwarded-for": "6.6.6.6" }), { kind: "cloudflare" })).toBeNull();
  });

  it("відкидає значення, що не є IP-адресою", () => {
    expect(getClientIp(h({ "x-forwarded-for": "evil, not-an-ip" }), { kind: "hops", count: 1 })).toBeNull();
    expect(getClientIp(h({ "cf-connecting-ip": "1.2.3.4; DROP TABLE" }), { kind: "cloudflare" })).toBeNull();
  });

  it("прибирає порт та дужки IPv6", () => {
    expect(getClientIp(h({ "x-real-ip": "203.0.113.5:51234" }), { kind: "vercel" })).toBe("203.0.113.5");
    expect(getClientIp(h({ "x-real-ip": "[2001:db8::1]:443" }), { kind: "vercel" })).toBe("2001:db8::1");
  });
});

describe("ipBucket", () => {
  it("лишає IPv4 без змін і повертає null для невідомого IP", () => {
    expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket(null)).toBeNull();
  });

  it("зводить IPv6 до підмережі /64", () => {
    expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("2001:db8::ffff")).toBe(ipBucket("2001:db8::1"));
  });

  it("розгортає IPv4-mapped IPv6 в IPv4", () => {
    expect(ipBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });
});
