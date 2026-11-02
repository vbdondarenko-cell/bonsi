import { z } from "zod";
import { getActor } from "@/lib/files/actor";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "project-files";

/**
 * Віддача файлу: доступ визначає RLS (рядок project_files має бути видимий користувачу), а потім сервер видає
 * підписане посилання на 60 секунд із примусовим завантаженням. Прямих публічних посилань на сховище немає.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Перехід за посиланням у браузері (Accept: text/html) отримує зрозумілу сторінку, програмні виклики — JSON.
  const navigation = (request.headers.get("accept") ?? "").includes("text/html");
  const notFound = () =>
    navigation
      ? new Response('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Файл недоступний</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Файл недоступний</h1><p>Файл видалено або у вас немає до нього доступу.</p><p><a href="/app">Повернутися в кабінет</a></p></body></html>', {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        })
      : Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!z.string().uuid().safeParse(id).success) return notFound();

  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const row = await actor.supabase.from("project_files").select("storage_path,display_name,deleted_at").eq("id", id).maybeSingle();
  if (row.error || !row.data || row.data.deleted_at) return notFound();

  try {
    const signed = await createSupabaseServiceClient()
      .storage.from(BUCKET)
      .createSignedUrl(row.data.storage_path as string, 60, { download: row.data.display_name as string });
    if (signed.error || !signed.data?.signedUrl) return notFound();
    return new Response(null, { status: 302, headers: { Location: signed.data.signedUrl, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return Response.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
