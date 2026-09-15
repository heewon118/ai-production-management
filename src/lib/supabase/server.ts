/** 서버(Server Component, Route Handler)에서 쓰는 Supabase 클라이언트 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component에서 호출되면 쿠키를 못 바꿀 수 있다.
            // proxy에서 세션을 이미 갱신하고 있으므로 여기서는 무시해도 된다.
          }
        },
      },
    },
  );
}
