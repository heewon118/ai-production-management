/**
 * 편집 권한 확인
 *
 * PRD 규칙: 조회는 비밀번호 없이 누구나 가능하고, 편집(입력/수정)만 비밀번호로 보호한다.
 * (나중에 이메일 로그인으로 교체할 예정인 임시 방식이다)
 *
 * ※ Microsoft 365(Azure AD) 로그인 기능은 이미 구현해뒀지만, 회사 Azure 관리자 동의가
 *   아직 안 나서 잠시 이 방식으로 되돌려둔 상태다. 동의를 받으면 이 파일을 다시
 *   Supabase 세션 확인 방식(isAuthenticated/signOut)으로 바꾸면 된다.
 *   관련 파일: src/app/login, src/app/auth/callback, src/lib/supabase, trash-can/proxy.ts
 */

import crypto from "node:crypto";
import { cookies } from "next/headers";

export const EDIT_COOKIE = "edit_mode";

/** 편집용 비밀번호. .env의 EDIT_PASSWORD로 바꿀 수 있다. */
export function getEditPassword(): string {
  return process.env.EDIT_PASSWORD ?? "1234";
}

/**
 * 쿠키에 저장할 값.
 * 비밀번호를 그대로 넣지 않고 해시값을 넣어서, 쿠키만 보고 비밀번호를 알 수 없게 한다.
 */
function issueToken(): string {
  return crypto.createHash("sha256").update(`ai-prod:${getEditPassword()}`).digest("hex");
}

/** 입력한 비밀번호가 맞는지 확인한다. */
export function verifyPassword(input: string): boolean {
  return input === getEditPassword();
}

/** 로그인(편집 모드) 쿠키를 심는다. */
export async function setEditCookie(): Promise<void> {
  const store = await cookies();
  store.set(EDIT_COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12시간
  });
}

/** 편집 모드를 해제한다. */
export async function clearEditCookie(): Promise<void> {
  const store = await cookies();
  store.delete(EDIT_COOKIE);
}

/** 현재 요청이 편집 권한을 가지고 있는지 확인한다. */
export async function isEditor(): Promise<boolean> {
  const store = await cookies();
  return store.get(EDIT_COOKIE)?.value === issueToken();
}
