/**
 * Microsoft 로그인 콜백
 *
 * Microsoft 로그인이 끝나면 Supabase가 이 주소로 돌려보낸다.
 * 전달받은 code를 실제 로그인 세션으로 교환한 뒤 원래 보려던 화면으로 이동시킨다.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 코드가 없거나 교환에 실패하면 로그인 화면으로 돌려보낸다.
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
