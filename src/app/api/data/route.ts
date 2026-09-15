/** 화면에서 쓰는 전체 데이터를 한 번에 내려준다. */

import { ok } from "@/lib/api";
import { isEditor } from "@/lib/auth";
import { readDb } from "@/lib/storage";

export async function GET() {
  const db = await readDb();
  return ok({ ...db, editor: await isEditor() });
}
