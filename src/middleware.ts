import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthEnv, type CookieItem } from "@/lib/supabase/env";

const ADMIN_LOGIN_PATH = "/admin/login";
const ADMIN_PUBLIC_PATHS = new Set([ADMIN_LOGIN_PATH, "/admin/register"]);
const CLIENT_LOGIN_PATH = "/login";

function harden(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * Перший рубіж для /admin, /app та /login: оновлює сесію й відсікає неавторизованих.
 * Остаточні перевірки (роль, MFA, належність проєкту, RLS) виконуються на сервері в кожній сторінці й дії,
 * тому обхід middleware не дає доступу до даних.
 */
export async function middleware(request: NextRequest) {
  const env = getSupabaseAuthEnv();
  const path = request.nextUrl.pathname;
  const isAdminArea = path === "/admin" || path.startsWith("/admin/");
  const isClientArea = path === "/app" || path.startsWith("/app/");
  const loginPath = isAdminArea ? ADMIN_LOGIN_PATH : CLIENT_LOGIN_PATH;
  const isPublic = ADMIN_PUBLIC_PATHS.has(path) || path === CLIENT_LOGIN_PATH || path.startsWith("/auth/");

  if (!env) {
    if (isPublic) return harden(NextResponse.next({ request }));
    return harden(NextResponse.redirect(new URL(loginPath, request.url)));
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
  if (!data.user && !isPublic && (isAdminArea || isClientArea)) {
    const target = new URL(loginPath, request.url);
    if (isClientArea) target.searchParams.set("next", `${path}${request.nextUrl.search}`);
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return harden(redirect);
  }

  return harden(response);
}

export const config = { matcher: ["/admin", "/admin/:path*", "/app", "/app/:path*", "/login", "/auth/:path*"] };
