import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) bits += ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

const STATE_DIR = ".ci/admin-state";
const stateFile = (email: string) => `${STATE_DIR}/${email.replace(/[^a-z0-9]/gi, "_")}.json`;

type State = { secret: string; lastStep: number };

export function saveSecret(email: string, secret: string) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile(email), JSON.stringify({ secret, lastStep: 0 } satisfies State));
}

export function loadState(email: string): State | null {
  return existsSync(stateFile(email)) ? (JSON.parse(readFileSync(stateFile(email), "utf8")) as State) : null;
}

/** Повертає код, якого ще не використовували (якщо крок уже витрачений — чекає наступного). */
export async function freshCode(email: string): Promise<string> {
  const state = loadState(email);
  if (!state) throw new Error(`Немає секрету TOTP для ${email}`);
  let step = Math.floor(Date.now() / 30_000);
  if (step <= state.lastStep) {
    const wait = (state.lastStep + 1) * 30_000 - Date.now() + 500;
    await new Promise((resolve) => setTimeout(resolve, Math.max(wait, 0)));
    step = Math.floor(Date.now() / 30_000);
  }
  writeFileSync(stateFile(email), JSON.stringify({ secret: state.secret, lastStep: step } satisfies State));
  return totpAt(state.secret, step);
}
