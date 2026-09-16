/**
 * 입력값 검증 (서버·화면 양쪽에서 쓰므로 서버 전용 코드에 의존하지 않는다)
 */

/** 숫자 입력값을 검증한다. 음수는 허용하지 않는다. (PRD 규칙) */
export function parsePositiveNumber(value: unknown, label: string, allowZero = false): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${label}을(를) 숫자로 입력해주세요.`);
  }
  if (num < 0) {
    throw new Error(`${label}에 음수를 입력할 수 없습니다.`);
  }
  if (!allowZero && num === 0) {
    throw new Error(`${label}은(는) 0보다 커야 합니다.`);
  }
  return num;
}

/** 비어 있지 않은 문자열인지 확인한다. */
export function parseRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}을(를) 입력해주세요.`);
  }
  return value.trim();
}

/** 날짜(YYYY-MM-DD) 또는 빈 값을 검증한다. 비워두면 null로 본다. */
export function parseOptionalDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label}은(는) YYYY-MM-DD 형식으로 입력해주세요.`);
  }
  return value;
}
