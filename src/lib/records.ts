/**
 * 생산실적 저장/수정 및 화면 표시에서 공통으로 쓰는 계산
 * (POST로 새로 만들 때, PATCH로 고칠 때, 이력 표에서 실시간으로 보여줄 때 모두 같은 함수를 쓴다)
 */

import { calcRecoveredAmount } from "./roi";
import { effectiveStandardST } from "./stats";
import type { Database, Equipment } from "./types";

/**
 * 이 공정에 연결된 자동화 설비 기준으로 효과금액을 계산한다.
 * 설비가 연결되어 있지 않으면 회수액은 없음(null)으로 본다.
 * 저장된 값이 아니라 항상 "지금" 설비 계산식으로 다시 계산하므로, 화면 표시용으로도 그대로 쓸 수 있다.
 */
export function calcRecordRecovery(
  db: Database,
  processId: string,
  quantity: number,
  productionMinutes: number,
): { equipmentId: string | null; recoveredAmount: number | null; recoveredNote: string | null } {
  const process = db.processes.find((item) => item.id === processId);
  const equipmentId = process?.equipmentId ?? null;
  if (!equipmentId) {
    return { equipmentId: null, recoveredAmount: null, recoveredNote: null };
  }

  const equipment = db.equipments.find((item) => item.id === equipmentId) as Equipment | undefined;
  if (!equipment) {
    return {
      equipmentId,
      recoveredAmount: null,
      recoveredNote: "공정에 연결된 자동화 설비를 찾을 수 없습니다.",
    };
  }

  // 표준ST는 직접 넣은 값이 없으면 하위 공정 합산을 쓴다.
  // 그래도 값이 없으면 회수액은 계산하지 못하지만, 실적 자체는 저장한다. (PRD 규칙)
  const result = calcRecoveredAmount(
    { quantity, productionMinutes, standardST: effectiveStandardST(processId, db.processes) },
    equipment,
  );
  return { equipmentId, recoveredAmount: result.amount, recoveredNote: result.note };
}
