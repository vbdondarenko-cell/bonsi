#!/usr/bin/env node
// Threads API helper: публікація постів, власна статистика, пошук за ключовим словом.
// Токен передавай через env, не хардкодь у файл: THREADS_ACCESS_TOKEN=THAAQ... node threads-bot.mjs <command> ...

const TOKEN = process.env.THREADS_ACCESS_TOKEN;
const BASE = "https://graph.threads.net/v1.0";

if (!TOKEN) {
  console.error("Задай THREADS_ACCESS_TOKEN в env");
  process.exit(1);
}

async function publishPost(text) {
  const create = await fetch(
    `${BASE}/me/threads?media_type=TEXT&text=${encodeURIComponent(text)}&access_token=${TOKEN}`,
    { method: "POST" },
  );
  const createJson = await create.json();
  if (!createJson.id) throw new Error("create failed: " + JSON.stringify(createJson));

  const publish = await fetch(
    `${BASE}/me/threads_publish?creation_id=${createJson.id}&access_token=${TOKEN}`,
    { method: "POST" },
  );
  const publishJson = await publish.json();
  if (!publishJson.id) throw new Error("publish failed: " + JSON.stringify(publishJson));
  return publishJson.id;
}

async function getPostUrl(id) {
  const r = await fetch(`${BASE}/${id}?fields=permalink&access_token=${TOKEN}`);
  return (await r.json()).permalink;
}

async function getInsights() {
  const r = await fetch(
    `${BASE}/me/threads_insights?metric=views,likes,replies,reposts,quotes,followers_count&access_token=${TOKEN}`,
  );
  return r.json();
}

async function searchKeyword(keyword, type = "RECENT") {
  const r = await fetch(
    `${BASE}/keyword_search?q=${encodeURIComponent(keyword)}&search_type=${type}&access_token=${TOKEN}`,
  );
  return r.json();
}

async function getMyRecentPosts(limit = 10) {
  const r = await fetch(
    `${BASE}/me/threads?fields=id,text,permalink,timestamp&limit=${limit}&access_token=${TOKEN}`,
  );
  return r.json();
}

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "post": {
    const text = args.join(" ");
    if (!text) { console.error("Текст пусти: node threads-bot.mjs post \"текст посту\""); process.exit(1); }
    const id = await publishPost(text);
    console.log("Опубліковано, id:", id, "url:", await getPostUrl(id));
    break;
  }
  case "insights": {
    console.log(JSON.stringify(await getInsights(), null, 2));
    break;
  }
  case "search": {
    const keyword = args[0];
    if (!keyword) { console.error("Потрібне слово: node threads-bot.mjs search bonsi"); process.exit(1); }
    console.log(JSON.stringify(await searchKeyword(keyword), null, 2));
    break;
  }
  case "recent": {
    console.log(JSON.stringify(await getMyRecentPosts(), null, 2));
    break;
  }
  default:
    console.log(`Команди:
  node threads-bot.mjs post "текст посту"
  node threads-bot.mjs insights
  node threads-bot.mjs search <ключове_слово>
  node threads-bot.mjs recent`);
}
