import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthEnv, type CookieItem } from "@/lib/supabase/env";

const ADMIN_LOGIN_PATH = "/admin/login";

function harden(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * Перший рубіж для /admin: оновлює сесію й відсікає неавторизованих.
 * Остаточні перевірки (allowlist, MFA, RLS) виконуються на сервері в кожній сторінці й дії,
 * тому обхід middleware не дає доступу до даних.
 */
export async function middleware(request: NextRequest) {
  const env = getSupabaseAuthEnv();
  const path = request.nextUrl.pathname;
  const isPublic = path === ADMIN_LOGIN_PATH;

  if (!env) {
    if (isPublic) return harden(NextResponse.next({ request }));
    return harden(NextResponse.redirect(new URL(ADMIN_LOGIN_PATH, request.url)));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items: CookieItem[]) => {
        for (const { name, value } of items) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user && !isPublic) {
    const redirect = NextResponse.redirect(new URL(ADMIN_LOGIN_PATH, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return harden(redirect);
  }

  return harden(response);
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
