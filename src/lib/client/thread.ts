import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMessageAttachments, getStudioReadCursor, type MessageRow } from "./data";

export type ThreadMessage = {
  id: number;
  role: "client" | "admin";
  body: string;
  at: string;
  readByStudio?: boolean;
  files?: Array<{ id: string; name: string; size: number }>;
};

/** Збирає повідомлення для клієнта: вкладення лише з наявних (не видалених) файлів і позначка «прочитано студією». */
export async function toThreadMessages(supabase: SupabaseClient, projectId: string, rows: MessageRow[]): Promise<ThreadMessage[]> {
  const [attachments, studioRead] = await Promise.all([getMessageAttachments(supabase, projectId, rows.map((row) => row.id)), getStudioReadCursor(supabase, projectId)]);
  return rows.map((row) => ({
    id: row.id,
    role: row.author_role,
    body: row.body,
    at: row.created_at,
    readByStudio: row.author_role === "client" && row.id <= studioRead,
    files: attachments[row.id],
  }));
}
