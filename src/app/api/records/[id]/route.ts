/** 생산실적 수정 / 삭제 */

import type { NextRequest } from "next/server";
import {
  ok,
  parsePositiveNumber,
  parseRequiredString,
  requireEditor,
  toErrorResponse,
} from "@/lib/api";
import { calcRecordRecovery } from "@/lib/records";
import { updateDb } from "@/lib/storage";
import type { AssistType } from "@/lib/types";
import { calcProductionMinutes, classifyShift } from "@/lib/worktime";

/**
 * 생산실적의 모든 항목(일자·공정·시작종료시간·수량·담당자·지원구분)을 고칠 수 있다.
 * 시간이 바뀌면 생산시간·야간여부를 다시 계산하고, 공정·수량·시간 중 하나라도 바뀌면
 * 효과금액도 "지금" 계산식 기준으로 다시 계산해서 저장해둔다.
 * (화면에 보여줄 때는 이 저장값과 상관없이 항상 실시간으로 다시 계산한다)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = (await request.json()) as {
      date?: unknown;
      processId?: unknown;
      startTime?: unknown;
      endTime?: unknown;
      quantity?: unknown;
      worker?: unknown;
      assistType?: unknown;
    };

    const updated = await updateDb((db) => {
      const record = db.records.find((item) => item.id === id);
      if (!record) {
        throw new Error("생산실적을 찾을 수 없습니다.");
      }

      if ("date" in body) {
        record.date = parseRequiredString(body.date, "작업 일자");
      }

      if ("processId" in body) {
        const processId = parseRequiredString(body.processId, "공정");
        if (!db.processes.some((item) => item.id === processId)) {
          throw new Error("공정을 찾을 수 없습니다.");
        }
        record.processId = processId;
      }

      // 시간이 바뀌면 점심·휴식·정비시간을 뺀 생산시간과 야간여부를 다시 계산한다.
      if ("startTime" in body) {
        record.startTime = parseRequiredString(body.startTime, "시작시간");
      }
      if ("endTime" in body) {
        record.endTime = parseRequiredString(body.endTime, "종료시간");
      }
      if ("startTime" in body || "endTime" in body) {
        const { productionMinutes } = calcProductionMinutes(record.startTime, record.endTime);
        record.productionMinutes = productionMinutes;
        record.shift = classifyShift(record.startTime);
      }

      if ("quantity" in body) {
        record.quantity = parsePositiveNumber(body.quantity, "생산수량");
      }

      if ("worker" in body) {
        record.worker =
          typeof body.worker === "string" && body.worker.trim() ? body.worker.trim() : null;
      }

      if ("assistType" in body) {
        const assistType: AssistType =
          body.assistType === "support" || body.assistType === "leave" ? body.assistType : null;
        record.assistType = assistType;
      }

      // 공정·수량·시간 중 하나라도 바뀌면 효과금액을 다시 계산해서 저장해둔다.
      if ("processId" in body || "quantity" in body || "startTime" in body || "endTime" in body) {
        const { equipmentId, recoveredAmount, recoveredNote } = calcRecordRecovery(
          db,
          record.processId,
          record.quantity,
          record.productionMinutes,
        );
        record.equipmentId = equipmentId;
        record.recoveredAmount = recoveredAmount;
        record.recoveredNote = recoveredNote;
      }

      return record;
    });

    return ok(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** 생산실적을 삭제한다. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;

    await updateDb((db) => {
      const index = db.records.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error("생산실적을 찾을 수 없습니다.");
      }
      db.records.splice(index, 1);
    });

    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
