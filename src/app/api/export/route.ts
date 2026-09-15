/** 데이터 내보내기 (백업용 JSON 다운로드) */

import { readDb } from "@/lib/storage";

export async function GET() {
  const db = await readDb();
  const today = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...db }, null, 2);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-production-backup-${today}.json"`,
    },
  });
}
