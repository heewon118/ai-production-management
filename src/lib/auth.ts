/**
 * 편집 권한 확인
 *
 * PRD 규칙: 조회는 비밀번호 없이 누구나 가능하고, 편집(입력/수정)만 비밀번호로 보호한다.
 * (나중에 이메일 로그인으로 교체할 예정인 임시 방식이다)
 *
 * 비밀번호는 관리자 설정 화면에서 바꿀 수 있어, .env의 EDIT_PASSWORD가 아니라
 * Supabase의 settings 테이블(해시로 저장)이 실제 기준값이다. .env의 EDIT_PASSWORD는
 * 아직 한 번도 설정한 적이 없을 때(첫 실행)만 초기값으로 쓰인다.
 *
 * ※ Microsoft 365(Azure AD) 로그인 기능은 이미 구현해뒀지만, 회사 Azure 관리자 동의가
 *   아직 안 나서 잠시 이 방식으로 되돌려둔 상태다. 동의를 받으면 이 파일을 다시
 *   Supabase 세션 확인 방식(isAuthenticated/signOut)으로 바꾸면 된다.
 *   관련 파일: src/app/login, src/app/auth/callback, src/lib/supabase, trash-can/proxy.ts
 */

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { readPasswordHash, writePasswordHash } from "./storage";

export const EDIT_COOKIE = "edit_mode";

const SCRYPT_KEY_LENGTH = 64;

/** "salt:hash" 형태의 문자열로 비밀번호를 해시한다. */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/** 입력한 비밀번호가 저장된 해시와 같은지 확인한다. */
function matchesHash(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
  } catch {
    return false;
  }
}

/** 설정 테이블에 비밀번호 해시가 없으면(첫 실행) .env 값으로 만들어 저장해둔다. */
async function ensurePasswordHash(): Promise<string> {
  const stored = await readPasswordHash();
  if (stored) return stored;
  const initial = hashPassword(process.env.EDIT_PASSWORD ?? "1234");
  await writePasswordHash(initial);
  return initial;
}

/**
 * 쿠키에 저장할 값.
 * 비밀번호(해시)를 그대로 넣지 않고 한 번 더 해시한 값을 넣어서, 쿠키만 보고
 * 비밀번호 해시를 알 수 없게 한다. 비밀번호가 바뀌면 이 값도 달라지므로
 * 기존에 로그인해 있던 편집 모드는 자동으로 풀린다(다시 로그인해야 한다).
 */
function issueToken(passwordHash: string): string {
  return crypto.createHash("sha256").update(`ai-prod:${passwordHash}`).digest("hex");
}

/** 입력한 비밀번호가 맞는지 확인한다. */
export async function verifyPassword(input: string): Promise<boolean> {
  const stored = await ensurePasswordHash();
  return matchesHash(input, stored);
}

/** 로그인(편집 모드) 쿠키를 심는다. */
export async function setEditCookie(): Promise<void> {
  const stored = await ensurePasswordHash();
  const store = await cookies();
  store.set(EDIT_COOKIE, issueToken(stored), {
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
  const token = store.get(EDIT_COOKIE)?.value;
  if (!token) return false;
  const stored = await ensurePasswordHash();
  return token === issueToken(stored);
}

/** 현재 비밀번호를 확인한 뒤 새 비밀번호로 바꾼다. 현재 비밀번호가 틀리면 예외를 던진다. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const stored = await ensurePasswordHash();
  if (!matchesHash(currentPassword, stored)) {
    throw new Error("현재 비밀번호가 맞지 않습니다.");
  }
  if (newPassword.length < 4) {
    throw new Error("새 비밀번호는 4자 이상이어야 합니다.");
  }
  await writePasswordHash(hashPassword(newPassword));
}
