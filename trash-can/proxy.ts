/**
 * [일시 보류 — trash-can으로 이동됨]
 * Microsoft 365(Azure AD) 로그인 기능은 구현이 끝났지만, 회사 Azure 관리자 동의가
 * 아직 안 나서 사이트를 예전 비밀번호 방식으로 잠깐 되돌려뒀다. 이 파일을
 * `src/proxy.ts`로 다시 옮기기만 하면(Next.js가 이 정확한 경로/이름만 인식한다)
 * 로그인 강제가 다시 켜진다. 그때 src/lib/auth.ts · src/lib/api.ts ·
 * src/components/Header.tsx · src/app/api/auth/route.ts · src/lib/client.ts ·
 * production/processes/equipments 3개 페이지도 Microsoft 로그인 버전으로 같이
 * 되돌려야 한다 (git log에서 "Microsoft 365 로그인" 관련 커밋 참고).
 *
 * 아래는 원래 하던 일에 대한 설명 (되돌릴 때 그대로 유효함):
 *
 * 로그인 여부를 확인해서, 로그인 안 된 사용자는 화면 이동 시 /login으로 보낸다.
 *
 * 실제 데이터 보호는 각 API 라우트가 requireAuth()로 따로 확인한다 (src/lib/api.ts).
 * 여기서는 페이지 이동만 안내하고, /api·정적 파일·/login·/auth/callback은
 * matcher에서 제외해 무한 리다이렉트나 API 응답이 깨지는 문제를 막는다.
 *
 * 세션 갱신(토큰 refresh)은 반드시 여기(proxy)에서만 하고, Server Component나
 * Route Handler에서는 갱신된 세션을 읽기만 한다. 양쪽에서 같이 갱신하면 세션이
 * 꼬여서 사용자가 랜덤하게 로그아웃되는 문제가 있다고 Supabase 공식 문서에 안내되어 있다.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getSession()은 쿠키 값을 그대로 믿는 방식이라 위조 가능성이 있다.
  // getClaims()는 토큰 서명을 검증하므로 이걸로 로그인 여부를 판단한다.
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // api, 정적 파일(_next/static, _next/image), 로그인·콜백 화면은 이 안내에서 제외한다.
    "/((?!api|_next/static|_next/image|favicon.ico|login|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
