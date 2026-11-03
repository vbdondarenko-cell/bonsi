import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES } from "./templates";

/** Статичний аудит: які шаблони реально використовуються, чи детерміновані ключі ідемпотентності, чи немає секретів у логах пошти. */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
const files = walk(join(process.cwd(), "src"));
const source = (path: string) => readFileSync(path, "utf8");

describe("події, що створюють листи", () => {
  const usages = files.flatMap((f) => [...source(f).matchAll(/template:\s*"(\w+)"/g)].map((m) => ({ file: f.replace(process.cwd() + "/", ""), template: m[1]! })));

  it("кожен використаний шаблон оголошено; є принаймні події бізнес-процесу з вимог V0.5", () => {
    expect(usages.length).toBeGreaterThanOrEqual(14);
    for (const u of usages) expect(EMAIL_TEMPLATES as string[], `${u.file}: ${u.template}`).toContain(u.template);
    const used = new Set(usages.map((u) => u.template));
    for (const required of ["order_received", "new_proposal", "document_for_approval", "invoice_issued", "payment_confirmed", "new_message", "budget_change", "stage_completed", "handover_ready", "support_update", "project_completed"]) {
      expect(used.has(required), `немає події для ${required}`).toBe(true);
    }
  });

  it("ключі ідемпотентності детерміновані: без годинника й випадковості (виняток — вікно 15 хв для new_message)", () => {
    const keys = files.flatMap((f) => [...source(f).matchAll(/key:\s*(`[^`]*`)/g)].map((m) => ({ file: f.replace(process.cwd() + "/", ""), key: m[1]! })));
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const { file, key } of keys) {
      expect(key, `${file}: ${key}`).not.toMatch(/Date\.now|Math\.random|new Date|randomUUID/);
      if (/quarterHour\(/.test(key)) expect(key).toContain("new-message:");
    }
  });
});

describe("журнали пошти не містять секретів", () => {
  const mailFiles = files.filter((f) => /src\/lib\/email\/|src\/app\/api\/(auth\/email-hook|internal\/emails)\//.test(f));
  it("console.* у поштових модулях не виводить токени, коди, посилання чи паролі", () => {
    expect(mailFiles.length).toBeGreaterThan(4);
    for (const f of mailFiles) {
      for (const m of source(f).matchAll(/console\.(?:log|info|warn|error|debug)\(([^;]*)\);/g)) {
        expect(m[1], `${f}: console.${m[0]}`).not.toMatch(/\b(token|token_hash|code|link|pass|password|secret|apiKey|authorization)\b/i);
      }
    }
  });
  it("пароль SMTP і ключ Resend читаються лише з env", () => {
    for (const f of mailFiles) expect(source(f), f).not.toMatch(/(?:SMTP_PASS|RESEND_API_KEY)\s*[:=]\s*["'`][^"'`]{6,}/);
  });
});
