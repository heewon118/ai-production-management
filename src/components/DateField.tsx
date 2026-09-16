"use client";

/**
 * 날짜 입력칸. "20260901"처럼 숫자 8자리를 이어 쳐서 넣으면 "2026-09-01"로 자동 반영된다.
 * (생산실적입력의 시간 입력칸과 같은 방식 — 8자리를 다 채우면 바로 반영되고, 화면도 "YYYY-MM-DD"로 보여준다)
 */

import { useState } from "react";

type DateFieldProps = {
  /** "YYYY-MM-DD" 또는 빈 문자열(선택 안 함) */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
};

export default function DateField({ value, onChange, className, placeholder }: DateFieldProps) {
  // 입력 중에는 실제로 친 숫자만 담아둔다. null이면 편집 중이 아님(value를 그대로 보여준다).
  const [draft, setDraft] = useState<string | null>(null);

  function commit(digits: string) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    onChange(`${year}-${month}-${day}`);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? value}
      placeholder={placeholder ?? "20260901"}
      // 포커스를 주면 비워서, 기존 값을 지우지 않고도 바로 새 숫자를 이어 칠 수 있게 한다.
      onFocus={() => setDraft("")}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
        if (digits.length === 0) {
          // 다 지우면 바로 "선택 안 함"으로 반영한다 (필터 초기화 등에 쓴다).
          onChange("");
          setDraft("");
        } else if (digits.length === 8) {
          commit(digits);
          setDraft(null);
        } else {
          setDraft(digits);
        }
      }}
      onBlur={() => setDraft(null)}
      className={className}
    />
  );
}
