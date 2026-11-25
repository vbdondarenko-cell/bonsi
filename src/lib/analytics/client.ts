import {
  EMPTY_ATTRIBUTION,
  attributionFromParams,
  attributionFromReferrer,
  hostOf,
  type Attribution,
} from "./attribution";

const STORAGE_KEY = "bonsi_attr_v1";
const ENDPOINT = "/api/track";

type Stored = { attr: Attribution; landed: boolean };

function readStored(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    return parsed && typeof parsed === "object" && parsed.attr ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(value: Stored) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // приватний режим або заблоковане сховище: атрибуція просто не переживе перезавантаження
  }
}

function trackingDisabled(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function send(body: Record<string, unknown>) {
  const data = JSON.stringify(body);
  try {
    if (typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(ENDPOINT, new Blob([data], { type: "application/json" }))) return;
    }
  } catch {
    // нижче спробуємо звичайний fetch
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data,
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Джерело першого заходу в сесії (first-touch): utm/код посилання з адреси, інакше реферер, інакше прямий захід.
 * Далі в межах сесії всі перегляди й заявки прив'язуються до нього, навіть на інших сторінках.
 */
function resolveSession(): { attr: Attribution; landing: boolean } {
  const stored = readStored();
  const fromUrl = attributionFromParams(new URLSearchParams(window.location.search));

  if (stored) {
    // Нове явне джерело в адресі (наприклад, людина відсканувала інший стікер) замінює попереднє.
    if (fromUrl && JSON.stringify(fromUrl) !== JSON.stringify(stored.attr)) {
      writeStored({ attr: fromUrl, landed: true });
      return { attr: fromUrl, landing: true };
    }
    return { attr: stored.attr, landing: false };
  }

  const fromReferrer = attributionFromReferrer(hostOf(document.referrer), window.location.hostname);
  const attr: Attribution = fromUrl ?? (fromReferrer ? { ...EMPTY_ATTRIBUTION, ...fromReferrer } : EMPTY_ATTRIBUTION);
  writeStored({ attr, landed: true });
  return { attr, landing: true };
}

function payload(kind: "pageview" | "lead", landing: boolean, attr: Attribution) {
  return {
    kind,
    path: window.location.pathname,
    landing,
    referrer: landing ? document.referrer : undefined,
    source: attr.source,
    medium: attr.medium,
    campaign: attr.campaign,
    content: attr.content,
    linkCode: attr.linkCode,
  };
}

export function trackPageview() {
  if (trackingDisabled()) return;
  const { attr, landing } = resolveSession();
  send(payload("pageview", landing, attr));
}

/** Заявку надіслано: фіксуємо її за джерелом цієї сесії. */
export function trackLead() {
  if (trackingDisabled()) return;
  const { attr } = resolveSession();
  send(payload("lead", false, attr));
}
