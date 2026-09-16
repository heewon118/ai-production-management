/** 공정 수정 / 삭제 */

import type { NextRequest } from "next/server";
import { ok, parsePositiveNumber, parseRequiredString, requireEditor, toErrorResponse } from "@/lib/api";
import { updateDb } from "@/lib/storage";

/** 공정 이름이나 표준ST를 수정한다. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = (await request.json()) as {
      name?: unknown;
      team?: unknown;
      standardST?: unknown;
      equipmentId?: unknown;
      dailyTarget?: unknown;
      workers?: unknown;
      worker?: unknown;
      order?: unknown;
    };

    const updated = await updateDb((db) => {
      const process = db.processes.find((item) => item.id === id);
      if (!process) {
        throw new Error("공정을 찾을 수 없습니다.");
      }

      // 이름은 등록 후에도 언제든 바꿀 수 있다. 빈 이름은 막고, 같은 위치의 중복 이름도 막는다.
      if ("name" in body) {
        const name = parseRequiredString(body.name, "공정 이름");
        const duplicated = db.processes.some(
          (item) => item.id !== id && item.parentId === process.parentId && item.name === name,
        );
        if (duplicated) {
          throw new Error("같은 위치에 같은 이름의 공정이 이미 있습니다.");
        }
        process.name = name;
      }

      // [1단계(파트) 전용] 소속 팀을 바꾼다.
      if ("team" in body && process.parentId === null) {
        const team = parseRequiredString(body.team, "소속 팀");
        if (!db.teams.some((item) => item.id === team)) {
          throw new Error("존재하지 않는 팀입니다.");
        }
        process.team = team;
      }

      // 자동화 설비 연결 (빈 값이면 연결 해제)
      if ("equipmentId" in body) {
        const equipmentId =
          typeof body.equipmentId === "string" && body.equipmentId ? body.equipmentId : null;
        if (equipmentId && !db.equipments.some((item) => item.id === equipmentId)) {
          throw new Error("자동화 설비를 찾을 수 없습니다.");
        }
        process.equipmentId = equipmentId;
      }

      // 표준ST는 언제든 수정 가능하며, 비우면(null) 미등록 상태로 되돌린다.
      if ("standardST" in body) {
        if (body.standardST === null || body.standardST === "") {
          process.standardST = null;
        } else {
          process.standardST = parsePositiveNumber(body.standardST, "표준ST");
        }
      }

      // 일일 목표수량 (대시보드 달성 현황용). 비우면 목표 미설정 상태로 되돌린다.
      if ("dailyTarget" in body) {
        if (body.dailyTarget === null || body.dailyTarget === "") {
          process.dailyTarget = null;
        } else {
          process.dailyTarget = parsePositiveNumber(body.dailyTarget, "일일 목표수량");
        }
      }

      // [1단계 파트 전용] 담당자 이름 목록 — 콤마로 구분한 텍스트 그대로 저장한다.
      if ("workers" in body) {
        process.workers = typeof body.workers === "string" ? body.workers : "";
      }

      // [2단계 공정 전용] 전담 담당자 이름 (빈 값이면 지정 해제)
      if ("worker" in body) {
        const worker = typeof body.worker === "string" && body.worker.trim() ? body.worker.trim() : null;
        process.worker = worker;
      }

      // [2단계 공정 전용] 공정 목록·야마즈미 차트 표시 순서. 비우면 순서 지정을 해제한다.
      if ("order" in body) {
        if (body.order === null || body.order === "") {
          process.order = null;
        } else {
          process.order = parsePositiveNumber(body.order, "표시 순서", true);
        }
      }

      return process;
    });

    return ok(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** 공정을 삭제한다. 하위 공정이나 실적이 있으면 삭제하지 않는다. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;

    await updateDb((db) => {
      const index = db.processes.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error("공정을 찾을 수 없습니다.");
      }

      const hasChildren = db.processes.some((process) => process.parentId === id);
      if (hasChildren) {
        throw new Error("하위 공정이 있어 삭제할 수 없습니다. 하위 공정을 먼저 삭제해주세요.");
      }

      const hasRecords = db.records.some((record) => record.processId === id);
      if (hasRecords) {
        throw new Error("이 공정으로 등록된 생산실적이 있어 삭제할 수 없습니다.");
      }

      db.processes.splice(index, 1);
    });

    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
