import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { ProposalDecision } from "@/components/workspace/proposal-decision";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getDecisions, getProject, getProposals, type ProposalRow } from "@/lib/client/data";
import { PROPOSAL_STATUS_LABELS, formatMoney, scheduleAmounts } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Комерційна пропозиція" };

function ProposalBody({ proposal }: { proposal: ProposalRow }) {
  const total = proposal.price_amount === null ? null : Number(proposal.price_amount);
  return (
    <div className="flex flex-col gap-6">
      {proposal.summary ? <p className="whitespace-pre-wrap leading-relaxed">{proposal.summary}</p> : null}
      <div>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">Склад робіт</h3>
        <ul className="list-disc space-y-1 pl-5">
          {proposal.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Вартість</dt>
          <dd className="mt-1 text-xl font-semibold">{total === null ? "—" : formatMoney(total, proposal.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted">Орієнтовний термін</dt>
          <dd className="mt-1 text-xl font-semibold">{proposal.duration_days ? `${proposal.duration_days} дн.` : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Правок включено</dt>
          <dd className="mt-1 text-xl font-semibold">{proposal.included_revisions}</dd>
        </div>
      </dl>
      {total !== null ? (
        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">Графік платежів</h3>
          <ul className="flex flex-col gap-2">
            {scheduleAmounts(total, proposal.payment_schedule).map((part) => (
              <li key={part.label} className="flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3 text-sm">
                <span>
                  {part.label} <span className="text-muted">· {part.percent}%</span>
                </span>
                <span className="font-medium">{formatMoney(part.amount, proposal.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Це графік, а не рахунок: оплата в кабінеті ще не підключена, реквізити студія надішле окремо.</p>
        </div>
      ) : null}
      {proposal.acceptance_terms ? (
        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">Умови приймання результату</h3>
          <p className="whitespace-pre-wrap leading-relaxed">{proposal.acceptance_terms}</p>
        </div>
      ) : null}
    </div>
  );
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [proposals, decisions] = await Promise.all([getProposals(supabase, id), getDecisions(supabase, id)]);

  if (proposals.length === 0) {
    return (
      <EmptyState
        title="Пропозиції ще немає"
        description="Студія готує комерційну пропозицію за вашою заявкою. Коли вона буде готова, ви побачите її тут і отримаєте дію «Погодити» або «Попросити змін»."
      />
    );
  }

  const [latest, ...older] = proposals;
  return (
    <div className="flex flex-col gap-6">
      <Card
        title={`Версія ${latest!.version}: ${latest!.title}`}
        id="current-proposal"
      >
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Pill tone={latest!.status === "approved" ? "ok" : latest!.status === "sent" ? "accent" : latest!.status === "changes_requested" ? "warn" : "muted"}>
            {PROPOSAL_STATUS_LABELS[latest!.status] ?? latest!.status}
          </Pill>
          {latest!.sent_at ? <span className="text-xs text-muted">Надіслано {formatWhen(latest!.sent_at)}</span> : null}
        </div>
        <ProposalBody proposal={latest!} />
        {latest!.status === "sent" ? (
          <div className="mt-8 border-t border-line pt-6">
            <ProposalDecision proposalId={latest!.id} projectId={id} version={latest!.version} />
          </div>
        ) : null}
      </Card>

      {decisions.length > 0 ? (
        <Card title="Журнал рішень">
          <ol className="flex flex-col gap-3">
            {decisions.map((decision) => (
              <li key={decision.id} className="border-l-2 border-line pl-4 text-sm">
                <strong>{decision.decision === "approved" ? "Погоджено" : "Запитано зміни"}</strong> · версія {decision.proposal_version} ·{" "}
                <time dateTime={decision.created_at}>{formatWhen(decision.created_at)}</time>
                {decision.comment ? <p className="mt-1 text-muted">«{decision.comment}»</p> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {older.length > 0 ? (
        <Card title="Попередні версії">
          <ul className="flex flex-col gap-3">
            {older.map((proposal) => (
              <li key={proposal.id}>
                <details className="rounded-xl border border-line p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Версія {proposal.version}: {proposal.title} · {PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status}
                  </summary>
                  <div className="mt-4">
                    <ProposalBody proposal={proposal} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
