/**
 * 자동화 설비 효과금액 계산
 *
 * 규칙:
 * - 계산식은 사용자가 웹 화면에서 직접 입력한다.
 * - 화면(이력 표·대시보드)에 보여줄 때는 항상 "지금" 설비의 계산식·값으로 다시 계산한다.
 *   (계산식을 바꾸면 과거 실적의 효과금액도 새 계산식 기준으로 바뀌어 보인다)
 * - 표준ST가 아직 없어 계산할 수 없으면 실적만 저장하고 회수액은 비워둔다.
 */

import { evaluateFormula } from "./formula";
import type { Equipment, FormulaVariable } from "./types";
import { parsePositiveNumber, parseRequiredString } from "./validate";

/** 요청으로 들어온 계산식 변수 목록을 검증한다. */
export function parseVariables(value: unknown): FormulaVariable[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const raw = item as { name?: unknown; value?: unknown };
    const name = parseRequiredString(raw.name, "계산식 변수 이름");
    if (!/^[A-Za-z0-9_가-힣]+$/.test(name)) {
      throw new Error(`변수 이름 "${name}"에는 한글·영문·숫자만 쓸 수 있습니다.`);
    }
    // 변수 값은 0이어도 되지만, 음수 단가는 의미가 없으므로 막는다.
    const num = parsePositiveNumber(raw.value, `변수 "${name}"의 값`, true);
    return { name, value: num };
  });
}

/** 계산식에서 기본으로 쓸 수 있는 변수 설명 (화면 안내용) */
export const BUILT_IN_VARIABLES: { name: string; description: string }[] = [
  { name: "수량", description: "이번 실적의 생산수량 (개)" },
  { name: "생산시간", description: "휴게시간을 뺀 실제 생산시간 (분)" },
  { name: "표준ST", description: "해당 공정의 표준ST (초/개)" },
  { name: "절감시간", description: "표준시간 대비 아낀 시간 (분). 표준ST × 수량 ÷ 60 − 생산시간" },
];

/**
 * 계산식이 실제로 계산 가능한지 저장 전에 확인한다.
 * (문법 오류나 값이 없는 변수를 쓴 계산식이 저장되면, 나중에 실적마다 조용히 계산에 실패한다)
 */
export function validateFormula(formula: string, variables: FormulaVariable[]): void {
  const testValues: Record<string, number> = {};
  // 기본 변수는 임시로 1을 넣어 문법과 변수명만 확인한다.
  for (const builtIn of BUILT_IN_VARIABLES) {
    testValues[builtIn.name] = 1;
  }
  for (const variable of variables) {
    testValues[variable.name] = variable.value;
  }

  // 계산에 실패하면 여기서 에러가 발생하고, 그대로 사용자에게 전달된다.
  evaluateFormula(formula, testValues);
}

export type RoiContext = {
  quantity: number;
  productionMinutes: number;
  standardST: number | null;
};

/** 계산식에 넣어줄 변수 값들을 만든다. */
export function buildRoiVariables(
  context: RoiContext,
  equipment: Equipment,
): Record<string, number> {
  const variables: Record<string, number> = {
    수량: context.quantity,
    생산시간: context.productionMinutes,
  };

  // 표준ST가 등록된 경우에만 표준ST / 절감시간을 쓸 수 있다.
  if (context.standardST !== null) {
    variables.표준ST = context.standardST;
    variables.절감시간 = (context.standardST * context.quantity) / 60 - context.productionMinutes;
  }

  // 사용자가 설비별로 등록한 값 (예: 시간당인건비)
  for (const variable of equipment.variables) {
    variables[variable.name] = variable.value;
  }

  return variables;
}

export type RoiResult = {
  /** 계산된 회수액. 계산할 수 없으면 null */
  amount: number | null;
  /** 계산하지 못한 이유 */
  note: string | null;
};

/**
 * 실적 1건에 대한 회수액을 계산한다.
 * 계산에 실패해도 실적 자체는 저장할 수 있도록, 에러를 던지지 않고 사유를 담아 돌려준다.
 */
export function calcRecoveredAmount(context: RoiContext, equipment: Equipment): RoiResult {
  try {
    const variables = buildRoiVariables(context, equipment);
    const amount = evaluateFormula(equipment.formula, variables);
    return { amount, note: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "계산식을 계산할 수 없습니다.";
    return { amount: null, note: reason };
  }
}
