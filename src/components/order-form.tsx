"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  DEADLINE_IDS,
  DEADLINE_LABELS,
  MAX_LINKS,
  parseLinks,
  SERVICE_IDS,
  SERVICE_QUESTIONS,
  type ServiceId,
} from "@/lib/orders/options";
import { checkedOrderSchema, orderSchema, type OrderFieldErrors } from "@/lib/orders/schema";
import { buildSummary, buildTelegramLink } from "@/lib/orders/summary";
import { services, supportPlans } from "@/lib/services";
import { telegram } from "@/lib/site";

type TextField = "name" | "phone" | "email" | "idea" | "links";

type Values = {
  service: ServiceId | "";
  deadline: string;
  /** Відповіді на уточнення обраної послуги: { questionId: optionId }. */
  details: Record<string, string>;
  idea: string;
  /** Посилання на приклади: по одному в рядок. */
  links: string;
  name: string;
  phone: string;
  email: string;
  consent: boolean;
};

type Choice = { id: string; label: string; hint?: string[] };

type Step =
  | { id: string; kind: "choice"; ask: string; options: Choice[]; optional: boolean }
  | { id: string; kind: "text"; ask: string; field: TextField; multiline?: boolean; placeholder: string; hint?: string; optional: boolean }
  | { id: "confirm"; kind: "confirm"; ask: string };

const emptyValues: Values = {
  service: "",
  deadline: "",
  details: {},
  idea: "",
  links: "",
  name: "",
  phone: "",
  email: "",
  consent: false,
};

const serviceTitles = Object.fromEntries(services.map((item) => [item.id, item.title])) as Record<ServiceId, string>;

const fieldClass =
  "w-full min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-fg " +
  "placeholder:text-muted/70 transition-colors hover:border-muted/60 focus-visible:border-accent-soft " +
  "aria-[invalid=true]:border-danger";

const serverMessages: Record<number, string> = {
  400: "Перевірте дані й спробуйте ще раз.",
  403: "Запит відхилено. Оновіть сторінку й спробуйте ще раз.",
  413: "Опис занадто великий. Скоротіть текст.",
  429: "Забагато заявок за короткий час. Спробуйте пізніше.",
  503: "Приймання заявок тимчасово недоступне. Спробуйте трохи пізніше.",
};

const serviceStep: Step = {
  id: "service",
  kind: "choice",
  ask: "Привіт! Я допоможу швидко оформити заявку: кілька коротких запитань, і ми продовжимо розмову в Telegram. Яка послуга вас цікавить?",
  options: SERVICE_IDS.map((id) => ({ id, label: serviceTitles[id] })),
  optional: false,
};

function buildSteps(service: ServiceId | ""): Step[] {
  if (!service) return [serviceStep];
  const questions: Step[] = SERVICE_QUESTIONS[service].map((question) => ({
    id: `q:${question.id}`,
    kind: "choice",
    ask: question.id === "plan" ? "Який пакет підтримки вас цікавить?" : /[?:]$/.test(question.label) ? question.label : `${question.label}:`,
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      hint: question.id === "plan" ? [...(supportPlans.find((plan) => plan.id === option.id)?.points ?? [])] : undefined,
    })),
    optional: true,
  }));
  return [
    serviceStep,
    ...questions,
    {
      id: "deadline",
      kind: "choice",
      ask: "Які бажані терміни?",
      options: DEADLINE_IDS.map((id) => ({ id, label: DEADLINE_LABELS[id] })),
      optional: true,
    },
    {
      id: "idea",
      kind: "text",
      field: "idea",
      multiline: true,
      ask: "Розкажіть коротко про задачу своїми словами. Кількох речень достатньо, подробиці уточнимо в розмові.",
      placeholder: "Наприклад: потрібен сайт для кав'ярні з меню та бронюванням столиків",
      optional: true,
    },
    {
      id: "links",
      kind: "text",
      field: "links",
      multiline: true,
      ask: "Є сайти чи макети, які вам подобаються? Киньте посилання на приклади.",
      placeholder: "https://…",
      hint: `До ${MAX_LINKS} посилань, кожне з нового рядка.`,
      optional: true,
    },
    { id: "name", kind: "text", field: "name", ask: "Як до вас звертатися?", placeholder: "Ваше імʼя", optional: false },
    {
      id: "phone",
      kind: "text",
      field: "phone",
      ask: "Залиште Telegram або телефон, якщо хочете, щоб ми написали першими.",
      placeholder: "@username або +380…",
      optional: true,
    },
    {
      id: "email",
      kind: "text",
      field: "email",
      ask: "Вкажіть email: надішлемо на нього підтвердження й номер звернення.",
      placeholder: "name@example.com",
      optional: false,
    },
    { id: "confirm", kind: "confirm", ask: "Майже готово! Перевірте заявку. Після надсилання відкриється чат у Telegram з уже підготовленим повідомленням." },
  ];
}

/** Яка відповідь стоїть за кроком; null — крок пропущено або ще без відповіді. */
function answerText(step: Step, values: Values): string | null {
  if (step.kind === "confirm") return null;
  if (step.kind === "text") {
    const raw = values[step.field].trim();
    if (!raw) return null;
    return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  }
  const current =
    step.id === "service" ? values.service : step.id === "deadline" ? values.deadline : values.details[step.id.slice(2)];
  return step.options.find((option) => option.id === current)?.label ?? null;
}

const fieldToStep: Record<string, string> = {
  service: "service",
  deadline: "deadline",
  idea: "idea",
  links: "links",
  name: "name",
  phone: "phone",
  email: "email",
  consent: "confirm",
};

function Bubble({ from, children, className }: { from: "bot" | "user"; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex", from === "user" && "justify-end")}>
      <div
        className={cn(
          "max-w-[90%] rounded-2xl px-4 py-3 text-base leading-relaxed sm:max-w-[80%]",
          from === "bot" ? "rounded-tl-md border border-line bg-surface-2" : "rounded-tr-md bg-accent text-white",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <Bubble from="bot" className="py-4">
      <span className="sr-only">Менеджер друкує…</span>
      <span aria-hidden="true" className="flex gap-1.5">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="size-2 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${dot * 150}ms` }} />
        ))}
      </span>
    </Bubble>
  );
}

export function OrderForm({ initialService, initialPlan }: { initialService?: ServiceId; initialPlan?: string }) {
  const toast = useToast();
  const startedAt = useRef(Date.now());
  const initialDetails: Record<string, string> =
    initialService === "support" && supportPlans.some((plan) => plan.id === initialPlan) ? { plan: initialPlan! } : {};
  const makeInitial = (): Values => ({ ...emptyValues, service: initialService ?? "", details: initialDetails });

  const [values, setValues] = useState<Values>(makeInitial);
  // Послугу обрано заздалегідь (картка послуги чи посилання): чат починається з наступного питання.
  const [cursor, setCursor] = useState(initialService ? 1 : 0);
  const [typing, setTyping] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<OrderFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<{ ticket: string; link: string } | null>(null);

  const interacted = useRef(false);
  const typingTimer = useRef<number | undefined>(undefined);
  const composerRef = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => buildSteps(values.service), [values.service]);
  const step = steps[Math.min(cursor, steps.length - 1)]!;
  const progress = Math.round(((done ? steps.length : cursor) / steps.length) * 100);

  useEffect(() => () => window.clearTimeout(typingTimer.current), []);

  // Після першої дії клієнта переносимо фокус і прокрутку на актуальне питання.
  useEffect(() => {
    if (!interacted.current || typing || done) return;
    const composer = composerRef.current;
    if (!composer) return;
    composer.querySelector<HTMLElement>("input:not([type=checkbox]), textarea, button")?.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    composer.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [cursor, typing, done]);

  function go(next: number) {
    interacted.current = true;
    window.clearTimeout(typingTimer.current);
    const forward = next > cursor;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setCursor(next);
    if (forward && !reduce) {
      setTyping(true);
      typingTimer.current = window.setTimeout(() => setTyping(false), 450);
    } else {
      setTyping(false);
    }
  }

  function clearError(name: keyof OrderFieldErrors) {
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function chooseOption(current: Step, option: Choice) {
    if (current.kind !== "choice") return;
    if (current.id === "service") {
      const service = option.id as ServiceId;
      // Відповіді на уточнення стосуються конкретної послуги: при зміні послуги скидаємо їх.
      setValues((prev) => ({ ...prev, service, details: service === prev.service ? prev.details : {} }));
      clearError("service");
    } else if (current.id === "deadline") {
      setValues((prev) => ({ ...prev, deadline: option.id }));
    } else {
      setValues((prev) => ({ ...prev, details: { ...prev.details, [current.id.slice(2)]: option.id } }));
    }
    go(cursor + 1);
  }

  function skipStep(current: Step) {
    if (current.kind === "choice") {
      if (current.id === "deadline") setValues((prev) => ({ ...prev, deadline: "" }));
      else if (current.id.startsWith("q:")) {
        setValues((prev) => {
          const details = { ...prev.details };
          delete details[current.id.slice(2)];
          return { ...prev, details };
        });
      }
    } else if (current.kind === "text") {
      setValues((prev) => ({ ...prev, [current.field]: "" }));
      clearError(current.field);
    }
    go(cursor + 1);
  }

  /** Перевіряє одне поле тією ж схемою, що й сервер; повертає текст помилки. */
  function validateField(field: TextField): string | undefined {
    const raw = values[field];
    const shape = orderSchema.shape;
    let result;
    switch (field) {
      case "name":
        result = shape.name.safeParse(raw);
        break;
      case "email":
        result = shape.email.safeParse(raw);
        break;
      case "phone":
        result = shape.phone.safeParse(raw.trim() === "" ? undefined : raw);
        break;
      case "idea":
        result = shape.idea.safeParse(raw.trim() === "" ? undefined : raw);
        break;
      case "links": {
        const links = parseLinks(raw);
        result = shape.links.safeParse(links.length ? links : undefined);
        break;
      }
    }
    return result.success ? undefined : (result.error.issues[0]?.message ?? "Перевірте значення");
  }

  function submitText(event: FormEvent<HTMLFormElement>, current: Extract<Step, { kind: "text" }>) {
    event.preventDefault();
    const message = validateField(current.field);
    if (message) {
      setErrors((prev) => ({ ...prev, [current.field]: [message] }));
      document.getElementById(`field-${current.field}`)?.focus();
      return;
    }
    clearError(current.field);
    go(cursor + 1);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !values.service) return;

    const questions = SERVICE_QUESTIONS[values.service];
    const details = Object.fromEntries(
      Object.entries(values.details).filter(([key, answer]) => answer && questions.some((q) => q.id === key)),
    );
    const links = parseLinks(values.links);
    const candidate = {
      service: values.service,
      idea: values.idea.trim() === "" ? undefined : values.idea,
      deadline: values.deadline === "" ? undefined : values.deadline,
      details: Object.keys(details).length ? details : undefined,
      links: links.length ? links : undefined,
      name: values.name,
      email: values.email,
      consent: values.consent,
      phone: values.phone.trim() === "" ? undefined : values.phone,
      website: honeypot,
      startedAt: startedAt.current,
    };

    const parsed = checkedOrderSchema.safeParse(candidate);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as OrderFieldErrors;
      setErrors(fieldErrors);
      // Некоректне поле з раннього кроку: повертаємо клієнта до нього.
      const firstField = Object.keys(fieldErrors).find((name) => name !== "consent");
      const target = firstField ? steps.findIndex((item) => item.id === (fieldToStep[firstField] ?? "")) : -1;
      if (target >= 0) go(target);
      else document.getElementById("field-consent")?.focus();
      return;
    }

    setSubmitting(true);
    setFailed(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as {
        ticket?: string;
        fieldErrors?: OrderFieldErrors;
        error?: string;
      } | null;

      if (response.status === 201 && body?.ticket) {
        const lines = buildSummary({
          service: parsed.data.service,
          details: parsed.data.details,
          deadline: parsed.data.deadline,
          idea: parsed.data.idea,
          links: parsed.data.links,
        });
        interacted.current = true;
        const link = buildTelegramLink(body.ticket, parsed.data.name, lines);
        setDone({ ticket: body.ticket, link });
        const gtag = (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
        gtag?.("event", "generate_lead", { service: parsed.data.service });
        gtag?.("event", "telegram_handoff", { service: parsed.data.service, auto: true });
        // Миттєвий перехід у чат @bonsi_studio; кнопка на екрані лишається запасною, якщо клієнт повернеться.
        window.location.assign(link);
        return;
      }

      // Сервер не зберіг заявку (не налаштований / збій): не губимо клієнта, а відкриваємо Telegram напряму.
      if (response.status >= 500) {
        setFailed(true);
        window.location.assign(
          buildTelegramLink(
            null,
            parsed.data.name,
            buildSummary({
              service: parsed.data.service,
              details: parsed.data.details,
              deadline: parsed.data.deadline,
              idea: parsed.data.idea,
              links: parsed.data.links,
            }),
          ),
        );
        return;
      }

      setFailed(true);
      if (response.status === 400 && body?.fieldErrors) {
        setErrors(body.fieldErrors);
        toast.push({ tone: "error", title: "Не вдалося надіслати заявку", description: serverMessages[400] });
        return;
      }
      if (response.status === 400 && body?.error === "too_fast") {
        toast.push({
          tone: "error",
          title: "Занадто швидко",
          description: "Зачекайте кілька секунд і натисніть «Надіслати заявку» ще раз.",
        });
        return;
      }
      toast.push({
        tone: "error",
        title: "Заявку не збережено",
        description: serverMessages[response.status] ?? "Сталася помилка сервера. Спробуйте ще раз пізніше.",
      });
    } catch {
      setFailed(true);
      toast.push({
        tone: "error",
        title: "Немає звʼязку з сервером",
        description: "Не вдалося підтвердити надсилання. Перевірте зʼєднання й спробуйте ще раз.",
      });
    } finally {
      window.clearTimeout(timeout);
      setSubmitting(false);
    }
  }

  async function copyTicket() {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(done.ticket);
      toast.push({ tone: "success", title: "Номер звернення скопійовано" });
    } catch {
      toast.push({ tone: "error", title: "Не вдалося скопіювати", description: "Виділіть номер вручну." });
    }
  }

  function reset() {
    setValues(makeInitial());
    setCursor(initialService ? 1 : 0);
    setErrors({});
    setFailed(false);
    setDone(null);
    setTyping(false);
    startedAt.current = Date.now();
  }

  const pastSteps = steps.slice(0, cursor);
  const summary = values.service
    ? buildSummary({
        service: values.service,
        details: values.details,
        deadline: values.deadline || undefined,
        idea: values.idea,
        links: parseLinks(values.links),
      })
    : [];

  function renderBack(): ReactNode {
    if (cursor === 0 || (initialService && cursor === 1)) return null;
    return (
      <button
        type="button"
        onClick={() => go(cursor - 1)}
        className="min-h-11 self-start rounded-full px-4 text-sm text-muted hover:text-fg sm:self-auto"
      >
        ← Назад
      </button>
    );
  }

  function renderControls(current: Step, withNext = false): ReactNode {
    const optional = current.kind !== "confirm" && current.optional;
    return (
      <div className="flex flex-wrap items-center gap-3">
        {withNext ? <Button type="submit">Далі</Button> : null}
        {optional ? (
          <button
            type="button"
            onClick={() => skipStep(current)}
            className="min-h-11 rounded-full border border-line px-4 text-sm text-muted hover:border-muted/60 hover:text-fg"
          >
            Пропустити
          </button>
        ) : null}
        {renderBack()}
      </div>
    );
  }

  function renderComposer(current: Step): ReactNode {
    if (current.kind === "choice") {
      const selected =
        current.id === "service" ? values.service : current.id === "deadline" ? values.deadline : values.details[current.id.slice(2)];
      const rich = current.options.some((option) => option.hint?.length);
      return (
        <div role="group" aria-label={current.ask} className="flex flex-col gap-3">
          <div
            id={current.id === "service" ? "field-service" : undefined}
            tabIndex={current.id === "service" ? -1 : undefined}
            className={cn("outline-none", rich ? "grid gap-3 sm:grid-cols-3" : "flex flex-wrap gap-2")}
          >
            {current.options.map((option) => {
              const isSelected = selected === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => chooseOption(current, option)}
                  className={cn(
                    "text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft",
                    rich ? "flex flex-col gap-2 rounded-2xl border p-4" : "min-h-11 rounded-full border px-4 py-2 text-sm",
                    isSelected ? "border-accent-soft bg-surface-2 text-fg" : "border-line text-muted hover:border-muted/60 hover:text-fg",
                  )}
                >
                  <span className={rich ? "font-semibold text-fg" : undefined}>{option.label}</span>
                  {option.hint ? (
                    <span className="flex flex-col gap-1 text-sm leading-relaxed text-muted">
                      {option.hint.map((point) => (
                        <span key={point}>{point}</span>
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {errors.service && current.id === "service" ? (
            <p id="field-service-error" className="text-sm text-danger">
              {errors.service[0]}
            </p>
          ) : null}
          {renderControls(current)}
        </div>
      );
    }

    if (current.kind === "text") {
      const error = errors[current.field]?.[0];
      const describedBy = error ? `field-${current.field}-error` : current.hint ? `field-${current.field}-hint` : undefined;
      const common = {
        id: `field-${current.field}`,
        name: current.field,
        "aria-label": current.ask,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        placeholder: current.placeholder,
        value: values[current.field],
        onChange: (event: { target: { value: string } }) => {
          setValues((prev) => ({ ...prev, [current.field]: event.target.value }));
          clearError(current.field);
        },
      };
      return (
        <form onSubmit={(event) => submitText(event, current)} noValidate className="flex flex-col gap-3">
          {current.multiline ? (
            <textarea
              {...common}
              rows={current.field === "idea" ? 4 : 3}
              maxLength={current.field === "idea" ? 3000 : undefined}
              inputMode={current.field === "links" ? "url" : undefined}
              autoComplete="off"
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit();
              }}
              className={cn(fieldClass, "resize-y")}
            />
          ) : (
            <input
              {...common}
              type={current.field === "email" ? "email" : "text"}
              inputMode={current.field === "email" ? "email" : "text"}
              autoComplete={current.field === "name" ? "name" : current.field === "email" ? "email" : "off"}
              autoCapitalize={current.field === "email" ? "none" : undefined}
              autoCorrect={current.field === "email" ? "off" : undefined}
              className={fieldClass}
            />
          )}
          {current.hint && !error ? (
            <p id={`field-${current.field}-hint`} className="text-sm text-muted">
              {current.hint}
            </p>
          ) : null}
          {error ? (
            <p id={`field-${current.field}-error`} className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {renderControls(current, true)}
        </form>
      );
    }

    return (
      <form onSubmit={submitOrder} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              id="field-consent"
              type="checkbox"
              name="consent"
              checked={values.consent}
              onChange={(event) => {
                setValues((prev) => ({ ...prev, consent: event.target.checked }));
                clearError("consent");
              }}
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={errors.consent ? "field-consent-error" : undefined}
              className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="text-sm leading-relaxed text-muted">
              Погоджуюсь на обробку наданих даних для відповіді на мою заявку відповідно до{" "}
              <Link href="/privacy" target="_blank" rel="noopener" className="text-accent-soft underline underline-offset-2 hover:text-fg">
                політики конфіденційності
              </Link>
              .
            </span>
          </label>
          {errors.consent ? (
            <p id="field-consent-error" className="text-sm text-danger">
              {errors.consent[0]}
            </p>
          ) : null}
        </div>
        {failed ? (
          <p className="text-sm text-muted">
            Не вдається зберегти заявку? Напишіть нам напряму:{" "}
            <a
              href={buildTelegramLink(null, values.name || "клієнт", summary)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-soft underline underline-offset-2 hover:text-fg"
            >
              {telegram.handle} у Telegram
            </a>
            .
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Надсилаємо…" : "Надіслати заявку"}
          </Button>
          {renderBack()}
        </div>
      </form>
    );
  }

  const recap = [
    ...summary,
    { label: "Імʼя", value: values.name },
    ...(values.phone.trim() ? [{ label: "Telegram / телефон", value: values.phone }] : []),
    { label: "Email", value: values.email },
  ];

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface/60">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-8">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent font-semibold text-white">
          B
        </span>
        <div className="min-w-0">
          <p className="font-medium">BONSI Studio</p>
          <p className="text-sm text-muted">{done ? "Заявку надіслано" : `Крок ${Math.min(cursor + 1, steps.length)} із ${steps.length}`}</p>
        </div>
      </header>
      <div aria-hidden="true" className="h-1 bg-line">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>

      <div role="log" aria-label="Діалог заявки" aria-live="polite" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        {pastSteps.map((past, index) => {
          const answer = answerText(past, values);
          return (
            <div key={past.id} className="flex flex-col gap-3">
              <Bubble from="bot">{past.ask}</Bubble>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={Boolean(done)}
                  onClick={() => go(index)}
                  aria-label={`${answer ?? "Пропущено"}. Змінити відповідь`}
                  className={cn(
                    "max-w-[90%] whitespace-pre-line break-words rounded-2xl rounded-tr-md px-4 py-3 text-left text-base leading-relaxed transition-opacity enabled:hover:opacity-90 sm:max-w-[80%]",
                    answer ? "bg-accent text-white" : "border border-line text-muted",
                  )}
                >
                  {answer ?? "Пропущено"}
                </button>
              </div>
            </div>
          );
        })}

        {done ? (
          <>
            <Bubble from="bot">
              <p className="font-medium">Дякуємо, заявку збережено!</p>
              <p className="mt-2 text-muted">Номер звернення:</p>
              <p className="mt-2 inline-block rounded-2xl border border-line bg-surface px-4 py-2 font-mono text-xl tracking-wider">
                {done.ticket}
              </p>
              <p className="mt-3 text-muted">Підтвердження надійде на {values.email}.</p>
            </Bubble>
            <Bubble from="bot">
              Відкриваємо чат у Telegram, щоб швидко узгодити деталі. Повідомлення вже підготовлено, вам лишається натиснути «Надіслати». Якщо Telegram не відкрився, натисніть кнопку нижче.
            </Bubble>
            <div role="status" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a
                href={done.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  (window as Window & { gtag?: (...args: unknown[]) => void }).gtag?.("event", "telegram_handoff", {
                    service: values.service,
                  })
                }
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-accent px-6 text-[0.95rem] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Продовжити в Telegram
                <span aria-hidden="true">↗</span>
              </a>
              <Button type="button" variant="ghost" onClick={copyTicket}>
                Скопіювати номер
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Нова заявка
              </Button>
            </div>
          </>
        ) : typing ? (
          <TypingBubble />
        ) : (
          <Bubble from="bot">{step.ask}</Bubble>
        )}

        {step.kind === "confirm" && !done && !typing ? (
          <dl className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-sm">
            {recap.map((line) => (
              <div key={line.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 text-muted sm:w-48">{line.label}</dt>
                <dd className="min-w-0 whitespace-pre-line break-words">{line.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {/* Honeypot: прихований від людей і допоміжних технологій. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Не заповнюйте це поле
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </label>
      </div>

      {!done && !typing ? (
        <div ref={composerRef} className="border-t border-line px-5 py-5 sm:px-8">
          {renderComposer(step)}
        </div>
      ) : null}
    </div>
  );
}
