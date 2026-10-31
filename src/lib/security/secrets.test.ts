import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Файли під контролем git (без залежностей і lock-файлів). */
function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.endsWith("package-lock.json"))
    .filter((file) => !/\.(png|jpe?g|webp|ico|woff2?|gif)$/i.test(file))
    .filter((file) => file !== "src/lib/security/secrets.test.ts");
}

const files = trackedFiles();
const read = (file: string) => readFileSync(file, "utf8");

describe("секрети та серверні ключі", () => {
  it("у репозиторії є файли для перевірки", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("не містить JWT, ключів sb_secret_ чи service_role зі значеннями", () => {
    const patterns: Array<[string, RegExp]> = [
      ["JWT", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
      ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
      ["service_role зі значенням", /service_role['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{20,}['"]/],
      ["приватний ключ", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ];
    const hits: string[] = [];
    for (const file of files) {
      const content = read(file);
      for (const [name, pattern] of patterns) {
        if (pattern.test(content)) hits.push(`${file}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("не комітить .env-файли зі значеннями (дозволено лише .env.example)", () => {
    const envFiles = files.filter((file) => /(^|\/)\.env(\..+)?$/.test(file) && !file.endsWith(".env.example"));
    expect(envFiles).toEqual([]);
  });

  it("не виставляє серверні ключі у браузер через префікс NEXT_PUBLIC_", () => {
    const hits = files.filter((file) => /NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET|PRIVATE|SALT)/.test(read(file)));
    expect(hits).toEqual([]);
  });

  it("клієнтські компоненти не імпортують серверний код і не читають серверні змінні", () => {
    const forbidden = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "ORDER_HASH_SALT",
      "@supabase/supabase-js",
      "@/lib/orders/service",
      "node:crypto",
    ];
    const hits: string[] = [];
    for (const file of files.filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
      const content = read(file);
      if (!/^\s*["']use client["']/m.test(content)) continue;
      for (const token of forbidden) {
        if (content.includes(token)) hits.push(`${file}: ${token}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("серверний модуль заявок захищений пакетом server-only", () => {
    expect(read("src/lib/orders/service.ts")).toMatch(/^import "server-only";/m);
  });
});
