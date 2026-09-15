/** 자동화 설비 목록 조회 / 추가 */

import type { NextRequest } from "next/server";
import { ok, parsePositiveNumber, parseRequiredString, requireEditor, toErrorResponse } from "@/lib/api";
import { parseVariables, validateFormula } from "@/lib/roi";
import { createId, readDb, updateDb } from "@/lib/storage";
import type { Equipment } from "@/lib/types";

export async function GET() {
  const db = await readDb();
  return ok(db.equipments);
}

export async function POST(request: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = parseRequiredString(body.name, "설비 이름");
    const investmentCost = parsePositiveNumber(body.investmentCost, "설비 도입비용", true);
    const initialRecovered = parsePositiveNumber(body.initialRecovered, "시작 시점 누적 회수액", true);
    const formula = parseRequiredString(body.formula, "회수액 계산식");
    const variables = parseVariables(body.variables);
    // 계산할 수 없는 계산식은 저장하지 않는다.
    validateFormula(formula, variables);

    const created = await updateDb((db) => {
      if (db.equipments.some((equipment) => equipment.name === name)) {
        throw new Error("같은 이름의 설비가 이미 있습니다.");
      }

      const equipment: Equipment = {
        id: createId(),
        name,
        investmentCost,
        initialRecovered,
        formula,
        variables,
      };
      db.equipments.push(equipment);
      return equipment;
    });

    return ok(created, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
