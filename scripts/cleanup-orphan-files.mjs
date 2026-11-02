#!/usr/bin/env node
// Знаходить об'єкти у приватному сховищі `project-files`, на які немає запису в project_files
// (завантаження обірвалось між upload і реєстрацією). За замовчуванням лише показує; видаляє тільки з --apply.
// Об'єкти молодші за --min-age-minutes (за замовчуванням 60) не чіпаємо: вони можуть бути в процесі реєстрації.
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const minAge = Number(args.find((a) => a.startsWith("--min-age-minutes="))?.split("=")[1] ?? 60);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Потрібні SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const bucket = supabase.storage.from("project-files");

const known = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from("project_files").select("storage_path").range(from, from + 999);
  if (error) throw new Error(`project_files: ${error.message}`);
  for (const row of data) known.add(row.storage_path);
  if (data.length < 1000) break;
}

const orphans = [];
const { data: folders, error: listError } = await bucket.list("", { limit: 1000 });
if (listError) throw new Error(`storage: ${listError.message}`);
for (const folder of folders ?? []) {
  for (let offset = 0; ; offset += 1000) {
    const { data: objects, error } = await bucket.list(folder.name, { limit: 1000, offset });
    if (error) throw new Error(`storage ${folder.name}: ${error.message}`);
    for (const object of objects ?? []) {
      const path = `${folder.name}/${object.name}`;
      const ageMin = (Date.now() - new Date(object.created_at ?? 0).getTime()) / 60000;
      if (!known.has(path) && ageMin >= minAge) orphans.push(path);
    }
    if ((objects ?? []).length < 1000) break;
  }
}
console.log(`Сиріт: ${orphans.length}${apply ? "" : " (dry-run; для видалення додайте --apply)"}`);
for (const path of orphans) console.log(`  ${path}`);
if (apply && orphans.length) {
  const { error } = await bucket.remove(orphans);
  if (error) throw new Error(`remove: ${error.message}`);
  console.log("Видалено.");
}
