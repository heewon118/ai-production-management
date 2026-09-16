/**
 * API 라우트에서 공통으로 쓰는 응답 도우미
 */

import { isEditor } from "./auth";

// 입력값 검증 함수는 화면에서도 쓰기 때문에 별도 파일에 두고, 여기서 다시 내보낸다.
export { parseOptionalDate, parsePositiveNumber, parseRequiredString } from "./validate";

/** 성공 응답 */
export function ok<T>(data: T, status = 200): Response {
  return Response.json(data as object, { status });
}

/** 실패 응답 (한국어 메시지) */
export function fail(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/**
 * 편집 권한을 확인한다.
 * 권한이 없으면 401 응답을 돌려주고, 있으면 null을 돌려준다.
 */
export async function requireEditor(): Promise<Response | null> {
  if (await isEditor()) return null;
  return fail("편집하려면 먼저 비밀번호를 입력해주세요.", 401);
}

/** 예외를 사용자에게 보여줄 메시지로 바꾼다. */
export function toErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
  return fail(message, 400);
}
