/** 담당자 목록 조회 / 추가 */

import type { NextRequest } from "next/server";
import { ok, parseRequiredString, requireEditor, toErrorResponse } from "@/lib/api";
import { createId, readDb, updateDb } from "@/lib/storage";
import type { Worker } from "@/lib/types";

export async function GET() {
  const db = await readDb();
  return ok(db.workers);
}

export async function POST(request: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const body = (await request.json()) as { name?: unknown };
    const name = parseRequiredString(body.name, "담당자 이름");

    const created = await updateDb((db) => {
      if (db.workers.some((worker) => worker.name === name)) {
        throw new Error("같은 이름의 담당자가 이미 있습니다.");
      }
      const worker: Worker = { id: createId(), name };
      db.workers.push(worker);
      return worker;
    });

    return ok(created, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
