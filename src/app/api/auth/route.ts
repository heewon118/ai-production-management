/** 편집 모드 로그인 / 로그아웃 */

import type { NextRequest } from "next/server";
import { fail, ok, requireEditor, toErrorResponse } from "@/lib/api";
import { changePassword, clearEditCookie, isEditor, setEditCookie, verifyPassword } from "@/lib/auth";

/** 현재 편집 권한이 있는지 확인 */
export async function GET() {
  return ok({ editor: await isEditor() });
}

/** 비밀번호를 확인하고 편집 모드로 전환 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";

    if (!(await verifyPassword(password))) {
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

/** 관리자 설정 화면에서 편집 비밀번호를 바꾼다. 바꾸면 지금 편집 모드는 풀린다(다시 로그인 필요). */
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireEditor();
    if (guard) return guard;

    const body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    await changePassword(currentPassword, newPassword);
    await clearEditCookie();
    return ok({ editor: false });
  } catch (error) {
    return toErrorResponse(error);
  }
}
