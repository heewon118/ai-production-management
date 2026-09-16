/** 생산팀 목록 조회 / 추가 */

import type { NextRequest } from "next/server";
import { ok, parseRequiredString, requireEditor, toErrorResponse } from "@/lib/api";
import { createId, readDb, updateDb } from "@/lib/storage";
import type { TeamRecord } from "@/lib/types";

export async function GET() {
  const db = await readDb();
  return ok(db.teams);
}

export async function POST(request: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const body = (await request.json()) as { name?: unknown };
    const name = parseRequiredString(body.name, "팀 이름");

    const created = await updateDb((db) => {
      if (db.teams.some((team) => team.name === name)) {
        throw new Error("같은 이름의 팀이 이미 있습니다.");
      }

      const team: TeamRecord = { id: createId(), name };
      db.teams.push(team);
      return team;
    });

    return ok(created, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
