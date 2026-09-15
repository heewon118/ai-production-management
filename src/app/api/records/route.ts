/** 생산실적 조회 / 등록 */

import type { NextRequest } from "next/server";
import { ok, parsePositiveNumber, parseRequiredString, requireEditor, toErrorResponse } from "@/lib/api";
import { calcRecordRecovery } from "@/lib/records";
import { createId, readDb, updateDb } from "@/lib/storage";
import type { AssistType, ProductionRecord } from "@/lib/types";
import { calcProductionMinutes, classifyShift } from "@/lib/worktime";

export async function GET() {
  const db = await readDb();
  return ok(db.records);
}

export async function POST(request: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const date = parseRequiredString(body.date, "작업 일자");
    const processId = parseRequiredString(body.processId, "공정");
    const startTime = parseRequiredString(body.startTime, "시작시간");
    const endTime = parseRequiredString(body.endTime, "종료시간");
    const quantity = parsePositiveNumber(body.quantity, "생산수량");
    const worker = typeof body.worker === "string" && body.worker.trim() ? body.worker.trim() : null;
    const assistType: AssistType =
      body.assistType === "support" || body.assistType === "leave" ? body.assistType : null;

    // 점심·휴식·정비시간을 제외한 실제 생산시간(분)을 구한다.
    const { productionMinutes } = calcProductionMinutes(startTime, endTime);
    // 시작시간이 근무 종료(17:30) 이후면 야간실적으로 구분한다.
    const shift = classifyShift(startTime);

    const created = await updateDb((db) => {
      const process = db.processes.find((item) => item.id === processId);
      if (!process) {
        throw new Error("공정을 찾을 수 없습니다.");
      }

      const { equipmentId, recoveredAmount, recoveredNote } = calcRecordRecovery(
        db,
        processId,
        quantity,
        productionMinutes,
      );

      const record: ProductionRecord = {
        id: createId(),
        date,
        processId,
        startTime,
        endTime,
        quantity,
        equipmentId,
        worker,
        assistType,
        shift,
        productionMinutes,
        recoveredAmount,
        recoveredNote,
        createdAt: new Date().toISOString(),
      };

      db.records.push(record);
      return record;
    });

    return ok(created, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
