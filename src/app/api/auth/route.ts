/** 편집 모드 로그인 / 로그아웃 */

import type { NextRequest } from "next/server";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { clearEditCookie, isEditor, setEditCookie, verifyPassword } from "@/lib/auth";

/** 현재 편집 권한이 있는지 확인 */
export async function GET() {
  return ok({ editor: await isEditor() });
}

/** 비밀번호를 확인하고 편집 모드로 전환 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";

    if (!verifyPassword(password)) {
      return fail("비밀번호가 맞지 않습니다.", 401);
    }

    await setEditCookie();
    return ok({ editor: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** 편집 모드 해제 */
export async function DELETE() {
  await clearEditCookie();
  return ok({ editor: false });
}
