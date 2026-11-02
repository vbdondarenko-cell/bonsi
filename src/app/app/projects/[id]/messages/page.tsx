import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageThread } from "@/components/workspace/message-thread";
import { requireClient } from "@/lib/client/auth";
import { getMessageAttachments, getMessages, getProject } from "@/lib/client/data";

export const metadata: Metadata = { title: "Повідомлення" };

export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [messages, attachments, reads] = await Promise.all([
    getMessages(supabase, id),
    getMessageAttachments(supabase, id),
    supabase.from("project_message_reads").select("last_read_id").eq("project_id", id).eq("reader_role", "admin").maybeSingle(),
  ]);
  const adminRead = Number(reads.data?.last_read_id ?? 0);
  const lastAdminId = messages.filter((m) => m.author_role === "admin").at(-1)?.id ?? 0;

  return (
    <MessageThread
      projectId={id}
      lastAdminId={lastAdminId}
      messages={messages.map((m) => ({ id: m.id, role: m.author_role, body: m.body, at: m.created_at, readByStudio: m.author_role === "client" && m.id <= adminRead, files: attachments[m.id] }))}
    />
  );
}
