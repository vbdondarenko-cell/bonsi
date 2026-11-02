import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { OtherSessionsForm, ProfileForm } from "@/components/workspace/profile-forms";
import { Card } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";

export const metadata: Metadata = { title: "Профіль і безпека" };

export default async function ProfilePage() {
  const { supabase, email, userId, displayName } = await requireClient();
  const profile = await supabase.from("client_profiles").select("phone").eq("user_id", userId).maybeSingle();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title="Профіль і безпека" />
      <Card title="Профіль">
        <p className="mb-5 text-sm text-muted">
          Пошта для входу: <strong className="break-all text-fg">{email}</strong>. Змінити її можна через студію — це та сама адреса, з якою
          повʼязані ваші заявки.
        </p>
        <ProfileForm name={displayName} phone={(profile.data?.phone as string | null) ?? ""} />
      </Card>
      <Card title="Безпека входу">
        <ul className="mb-5 list-disc space-y-2 pl-5 text-sm text-muted">
          <li>Паролів немає: вхід лише за одноразовим кодом або посиланням з листа на вашу пошту.</li>
          <li>Ви бачите лише власні проєкти, повідомлення та пропозиції.</li>
          <li>Якщо ви входили з чужого пристрою — завершіть інші сесії нижче.</li>
        </ul>
        <OtherSessionsForm />
      </Card>
    </div>
  );
}
