/** 공정 목록 조회 / 추가 */

import type { NextRequest } from "next/server";
import { ok, parseRequiredString, requireEditor, toErrorResponse } from "@/lib/api";
import { createId, readDb, updateDb } from "@/lib/storage";
import { getProcessLevel } from "@/lib/stats";
import type { Process } from "@/lib/types";

/** 공정 계층은 최대 5단계까지 만들 수 있다. (1단계 = 파트) */
const MAX_LEVEL = 5;

export async function GET() {
  const db = await readDb();
  return ok(db.processes);
}

export async function POST(request: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const body = (await request.json()) as { name?: unknown; parentId?: unknown; team?: unknown };
    const name = parseRequiredString(body.name, "공정 이름");
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
    // [1단계(파트) 전용] 이 파트가 속할 생산팀. 하위 공정은 상위 파트의 팀을 그대로 따르므로 필요 없다.
    const team = parentId === null ? parseRequiredString(body.team, "소속 팀") : undefined;

    const created = await updateDb((db) => {
      if (parentId) {
        const parent = db.processes.find((process) => process.id === parentId);
        if (!parent) {
          throw new Error("상위 공정을 찾을 수 없습니다.");
        }
        const parentLevel = getProcessLevel(parentId, db.processes);
        if (parentLevel >= MAX_LEVEL) {
          throw new Error(`공정은 최대 ${MAX_LEVEL}단계까지만 만들 수 있습니다.`);
        }
      }

      if (parentId === null && !db.teams.some((item) => item.id === team)) {
        throw new Error("존재하지 않는 팀입니다.");
      }

      // 파트(1단계)는 같은 팀 안에서만, 하위 공정은 같은 상위 공정 아래에서만 중복 이름을 막는다.
      const duplicated =
        parentId === null
          ? db.processes.some(
              (process) => process.parentId === null && process.team === team && process.name === name,
            )
          : db.processes.some((process) => process.parentId === parentId && process.name === name);
      if (duplicated) {
        throw new Error("같은 위치에 같은 이름의 공정이 이미 있습니다.");
      }

      const process: Process = {
        id: createId(),
        name,
        parentId,
        team,
        standardST: null,
        equipmentId: null,
        dailyTarget: null,
        // 1단계(파트)면 담당자 목록(콤마 텍스트), 2단계 이하면 전담 담당자 이름을 나중에 채운다.
        workers: parentId === null ? "" : undefined,
        worker: parentId !== null ? null : undefined,
      };
      db.processes.push(process);
      return process;
    });

    return ok(created, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
