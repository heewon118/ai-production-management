/** 자동화 설비 수정 / 삭제 */

import type { NextRequest } from "next/server";
import {
  ok,
  parseOptionalDate,
  parsePositiveNumber,
  parseRequiredString,
  requireEditor,
  toErrorResponse,
} from "@/lib/api";
import { parseVariables, validateFormula } from "@/lib/roi";
import { updateDb } from "@/lib/storage";

/**
 * 설비 정보와 계산식을 수정한다.
 * 계산식을 바꿔도 이미 저장된 실적의 회수액은 다시 계산하지 않는다. (PRD 규칙)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const updated = await updateDb((db) => {
      const equipment = db.equipments.find((item) => item.id === id);
      if (!equipment) {
        throw new Error("설비를 찾을 수 없습니다.");
      }

      if (typeof body.name === "string" && body.name.trim()) {
        equipment.name = body.name.trim();
      }
      if ("team" in body) {
        const team = parseRequiredString(body.team, "소속 팀");
        if (!db.teams.some((item) => item.id === team)) {
          throw new Error("존재하지 않는 팀입니다.");
        }
        equipment.team = team;
      }
      if ("investmentCost" in body) {
        equipment.investmentCost = parsePositiveNumber(body.investmentCost, "설비 도입비용", true);
      }
      if ("initialRecovered" in body) {
        equipment.initialRecovered = parsePositiveNumber(
          body.initialRecovered,
          "시작 시점 누적 회수액",
          true,
        );
      }
      if ("initialRecoveredUntil" in body) {
        equipment.initialRecoveredUntil = parseOptionalDate(
          body.initialRecoveredUntil,
          "누적 회수액 기준일",
        );
      }
      if ("variables" in body) {
        equipment.variables = parseVariables(body.variables);
      }
      if (typeof body.formula === "string" && body.formula.trim()) {
        equipment.formula = body.formula.trim();
      }

      // 바뀐 계산식과 값으로 실제 계산이 되는지 확인한다. 안 되면 저장하지 않는다.
      validateFormula(equipment.formula, equipment.variables);

      return equipment;
    });

    return ok(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** 설비를 삭제한다. 이 설비로 등록된 실적이 있으면 삭제하지 않는다. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;

    await updateDb((db) => {
      const index = db.equipments.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error("설비를 찾을 수 없습니다.");
      }

      const hasRecords = db.records.some((record) => record.equipmentId === id);
      if (hasRecords) {
        throw new Error("이 설비로 등록된 생산실적이 있어 삭제할 수 없습니다.");
      }

      db.equipments.splice(index, 1);
    });

    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
