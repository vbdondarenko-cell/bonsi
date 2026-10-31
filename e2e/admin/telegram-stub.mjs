// Локальна заглушка Telegram Bot API для e2e: зберігає повідомлення й уміє імітувати збої.
import { createServer } from "node:http";

const received = [];
let failNext = 0;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  const send = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };

  if (url.pathname === "/__health") return send(200, { ok: true });
  if (url.pathname === "/__received") return send(200, received);
  if (url.pathname === "/__reset") {
    received.length = 0;
    failNext = 0;
    return send(200, { ok: true });
  }
  if (url.pathname === "/__fail") {
    failNext = Number(url.searchParams.get("n") ?? 1);
    return send(200, { failNext });
  }
  if (/^\/bot[^/]+\/sendMessage$/.test(url.pathname) && req.method === "POST") {
    if (failNext > 0) {
      failNext -= 1;
      return send(500, { ok: false, description: "simulated failure" });
    }
    received.push({ path: url.pathname, body: JSON.parse(body) });
    return send(200, { ok: true, result: {} });
  }
  return send(404, { ok: false });
}).listen(4010, "127.0.0.1");
