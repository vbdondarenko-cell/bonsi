/**
 * Точка входу для cPanel / Phusion Passenger.
 *
 * Перед запуском зберіть self-contained сервер:
 *   npm ci && npm run build:standalone
 *
 * Після збірки цей файл підхоплює .next/standalone/server.js, який слухає PORT,
 * переданий cPanel. Для звичайного `npm start` цей файл не використовується.
 */
const path = require("node:path");

const entry = path.join(__dirname, ".next", "standalone", "server.js");

try {
  require(entry);
} catch (error) {
  console.error(
    "[bonsi] Не знайдено .next/standalone/server.js. Виконайте `npm run build:standalone` на хостингу.",
  );
  throw error;
}
