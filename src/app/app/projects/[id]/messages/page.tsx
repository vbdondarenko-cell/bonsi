import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageThread } from "@/components/workspace/message-thread";
import { requireClient } from "@/lib/client/auth";
import { getMessages, getProject } from "@/lib/client/data";
import { toThreadMessages } from "@/lib/client/thread";

export const metadata: Metadata = { title: "Повідомлення" };

export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const page = await getMessages(supabase, id);
  const messages = await toThreadMessages(supabase, id, page.messages);

  return <MessageThread projectId={id} initialMessages={messages} initialHasMore={page.hasMore} />;
}
