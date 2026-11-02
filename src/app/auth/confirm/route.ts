import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/client/safe-next";
import { sessionIsStaff } from "@/lib/client/separation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Вхід за посиланням із листа (Magic Link): перевіряє token_hash на сервері, створює сесію й веде в кабінет. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const fail = NextResponse.redirect(new URL("/login?error=link", request.url));
  if (!tokenHash || (type !== "email" && type !== "magiclink")) return fail;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (error) return fail;
    // Адміністратори входять лише через /admin.
    if (await sessionIsStaff(supabase)) {
      await supabase.auth.signOut();
      return fail;
    }
    await supabase.rpc("client_claim_orders");
  } catch {
    return fail;
  }
  const response = NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), request.url));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
