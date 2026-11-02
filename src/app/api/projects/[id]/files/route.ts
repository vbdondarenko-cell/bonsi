import { z } from "zod";
import { isSameOrigin } from "@/lib/http/same-origin";
import { getActor } from "@/lib/files/actor";
import {
  ADMIN_CATEGORIES,
  CLIENT_CATEGORIES,
  FILE_ERRORS,
  MAX_FILES_PER_REQUEST,
  MAX_REQUEST_BYTES,
  checkFile,
} from "@/lib/files/policy";
import { PayloadTooLargeError, withBodyLimit } from "@/lib/http/read-body";
import { storagePath } from "@/lib/files/storage";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "project-files";
/** Одночасні завантаження одного користувача (в межах інстансу): обмежує пам'ять, яку може зайняти один обліковий запис. */
const MAX_CONCURRENT_UPLOADS = 3;
const inFlight = new Map<string, number>();
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Завантаження файлів у приватне сховище проєкту. Права визначає база: реєстрація файлу — security definer-функція,
 * яка перевіряє, що користувач — клієнт цього проєкту або адміністратор. Об'єкт без запису в БД одразу видаляється.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const { id: projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return json({ error: "not_found" }, 404);

  const actor = await getActor();
  if (!actor) return json({ error: "unauthorized" }, 401);

  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) return json({ error: "length_required" }, 411);
  if (length > MAX_REQUEST_BYTES) return json({ error: "payload_too_large" }, 413);

  // Існування проєкту й належність перевіряє RLS: чужий проєкт дає порожній результат.
  const project = await actor.supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (project.error || !project.data) return json({ error: "not_found" }, 404);

  const active = inFlight.get(actor.userId) ?? 0;
  if (active >= MAX_CONCURRENT_UPLOADS) return json({ error: "too_many_uploads" }, 429);
  inFlight.set(actor.userId, active + 1);
  try {
    return await handle(request, projectId, actor);
  } finally {
    const left = (inFlight.get(actor.userId) ?? 1) - 1;
    if (left <= 0) inFlight.delete(actor.userId);
    else inFlight.set(actor.userId, left);
  }
}

async function handle(request: Request, projectId: string, actor: NonNullable<Awaited<ReturnType<typeof getActor>>>) {
  let form: FormData;
  try {
    // Ліміт рахується під час читання: заголовок Content-Length клієнт може збрехати.
    form = await withBodyLimit(request, MAX_REQUEST_BYTES).formData();
  } catch (error) {
    const tooLarge = error instanceof PayloadTooLargeError || (error instanceof Error && error.cause instanceof PayloadTooLargeError);
    return tooLarge ? json({ error: "payload_too_large" }, 413) : json({ error: "invalid_form" }, 400);
  }

  const categories = actor.role === "admin" ? ADMIN_CATEGORIES : CLIENT_CATEGORIES;
  const category = z.enum(categories as unknown as [string, ...string[]]).safeParse(form.get("category") ?? "other");
  if (!category.success) return json({ error: "invalid_category" }, 400);
  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (files.length === 0 || files.length > MAX_FILES_PER_REQUEST) return json({ error: "invalid_files" }, 400);
  const visible = actor.role === "admin" ? form.get("visible") !== "false" : true;
  const deliverable = actor.role === "admin" ? z.string().uuid().safeParse(form.get("deliverableId")) : null;

  let storage;
  try {
    storage = createSupabaseServiceClient().storage.from(BUCKET);
  } catch {
    return json({ error: "storage_unavailable" }, 503);
  }

  const saved: Array<{ id: string; name: string }> = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkFile(file.name, bytes.byteLength, bytes);
    if (!check.ok) {
      failed.push({ name: file.name, reason: FILE_ERRORS[check.reason] ?? "Файл відхилено." });
      continue;
    }
    const path = storagePath(projectId);
    const upload = await storage.upload(path, bytes, { contentType: check.mime, upsert: false });
    if (upload.error) {
      failed.push({ name: check.name, reason: "Не вдалося зберегти файл." });
      continue;
    }
    const register =
      actor.role === "admin"
        ? await actor.supabase.rpc("admin_register_file", {
            p_project: projectId,
            p_category: category.data,
            p_name: check.name,
            p_mime: check.mime,
            p_size: bytes.byteLength,
            p_path: path,
            p_visible: visible,
            p_deliverable: deliverable?.success ? deliverable.data : null,
          })
        : await actor.supabase.rpc("client_register_file", {
            p_project: projectId,
            p_category: category.data,
            p_name: check.name,
            p_mime: check.mime,
            p_size: bytes.byteLength,
            p_path: path,
          });
    if (register.error || typeof register.data !== "string") {
      await storage.remove([path]);
      failed.push({ name: check.name, reason: "Немає доступу або файл не прийнято." });
      continue;
    }
    saved.push({ id: register.data, name: check.name });
  }
  return json({ saved, failed }, saved.length > 0 ? 201 : 400);
}
