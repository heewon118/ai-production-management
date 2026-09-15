/** 담당자 수정 / 삭제 */

import type { NextRequest } from "next/server";
import { ok, parseRequiredString, requireEditor, toErrorResponse } from "@/lib/api";
import { updateDb } from "@/lib/storage";

/** 담당자 이름을 수정한다. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = (await request.json()) as { name?: unknown };
    const name = parseRequiredString(body.name, "담당자 이름");

    const updated = await updateDb((db) => {
      const worker = db.workers.find((item) => item.id === id);
      if (!worker) {
        throw new Error("담당자를 찾을 수 없습니다.");
      }
      if (db.workers.some((item) => item.id !== id && item.name === name)) {
        throw new Error("같은 이름의 담당자가 이미 있습니다.");
      }
      worker.name = name;
      return worker;
    });

    return ok(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** 담당자를 삭제한다. 이 담당자로 등록된 실적이 있으면 삭제하지 않는다. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor();
  if (denied) return denied;

  try {
    const { id } = await params;

    await updateDb((db) => {
      const index = db.workers.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error("담당자를 찾을 수 없습니다.");
      }
      if (db.records.some((record) => record.workerId === id)) {
        throw new Error("이 담당자로 등록된 생산실적이 있어 삭제할 수 없습니다.");
      }
      db.workers.splice(index, 1);
    });

    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
