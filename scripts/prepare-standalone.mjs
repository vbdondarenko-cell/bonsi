import { cp, access } from "node:fs/promises";
import { constants } from "node:fs";

/**
 * Next.js standalone не копіює статичні файли. Без цього кроку на cPanel
 * сторінки відкриються без CSS/JS. Запускається після `build:standalone`.
 */
const standalone = ".next/standalone";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(`${standalone}/server.js`))) {
  console.error("✗ .next/standalone/server.js не знайдено — спочатку виконайте next build з BUILD_STANDALONE=1");
  process.exit(1);
}

await cp(".next/static", `${standalone}/.next/static`, { recursive: true });

if (await exists("public")) {
  await cp("public", `${standalone}/public`, { recursive: true });
}

console.log("✓ Статичні файли скопійовано в .next/standalone");
