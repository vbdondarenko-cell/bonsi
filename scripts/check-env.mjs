#!/usr/bin/env node
// Перевірка змінних середовища перед запуском/деплоєм. Нічого не друкує зі значень секретів.
const env = process.env;
const errors = [];
const warnings = [];
// У production (або з CHECK_ENV_STRICT=1) небезпечна конфігурація блокує запуск, а не лишається попередженням.
const strict = env.NODE_ENV === "production" || env.CHECK_ENV_STRICT === "1";
const risk = (message) => (strict ? errors : warnings).push(message);

const need = (name) => {
  if (!env[name]) errors.push(`${name} не задано`);
  return env[name] ?? "";
};

const url = need("SUPABASE_URL");
if (url) {
  let host = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    if (u.protocol !== "https:") errors.push("SUPABASE_URL має бути https://");
    if (!host.endsWith(".supabase.co")) risk("SUPABASE_URL не схожий на *.supabase.co (self-hosted?)");
  } catch {
    errors.push("SUPABASE_URL не є коректним URL");
  }
  const ref = host.split(".")[0];
  const forbidden = (env.SUPABASE_FORBIDDEN_PROJECT_REFS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (ref && forbidden.includes(ref)) {
    errors.push(`SUPABASE_URL вказує на заборонений проєкт (${ref}). Використовуйте окремий проєкт BONSI.`);
  }
  if (forbidden.length === 0) {
    risk("SUPABASE_FORBIDDEN_PROJECT_REFS порожній: задайте ref сторонніх проєктів (напр. LinkUp), щоб випадково до них не підключитись");
  }
}

need("SUPABASE_SERVICE_ROLE_KEY");
if (need("ORDER_HASH_SALT").length < 32 && env.ORDER_HASH_SALT) errors.push("ORDER_HASH_SALT коротший за 32 символи");

for (const name of Object.keys(env)) {
  if (/^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|PRIVATE|SALT)/.test(name)) {
    errors.push(`${name}: секрет не можна виставляти у браузер через NEXT_PUBLIC_`);
  }
}

const proxy = env.TRUSTED_PROXY ?? "";
if (proxy && !/^(none|vercel|cloudflare|hops:[1-9]\d?)$/.test(proxy)) errors.push(`TRUSTED_PROXY має некоректне значення: ${proxy}`);
if (!proxy) risk("TRUSTED_PROXY не задано: без нього IP клієнта для обмежень частоти визначається ненадійно");
const site = env.NEXT_PUBLIC_SITE_URL ?? "";
if (!site || /^http:\/\/(localhost|127\.)/.test(site)) {
  risk("NEXT_PUBLIC_SITE_URL не задано або вказує на localhost (sitemap/OG/canonical/посилання входу)");
} else if (strict && !site.startsWith("https://")) {
  errors.push("NEXT_PUBLIC_SITE_URL у production має бути https://");
}

for (const w of warnings) console.warn(`⚠ ${w}`);
for (const e of errors) console.error(`✗ ${e}`);
if (errors.length) process.exit(1);
console.log("✓ Змінні середовища коректні");
