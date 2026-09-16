/**
 * 로컬 data/db.json의 데이터를 Supabase 테이블로 한 번만 옮기는 스크립트.
 * 실행: node --env-file=.env scripts/migrate-to-supabase.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const db = JSON.parse(readFileSync("data/db.json", "utf-8"));

const teamRows = db.teams;

const equipmentRows = db.equipments.map((e) => ({
  id: e.id,
  name: e.name,
  team: e.team,
  investment_cost: e.investmentCost,
  initial_recovered: e.initialRecovered,
  initial_recovered_until: e.initialRecoveredUntil ?? null,
  formula: e.formula,
  variables: e.variables,
}));

const processRows = db.processes.map((p) => ({
  id: p.id,
  name: p.name,
  parent_id: p.parentId,
  team: p.team ?? null,
  standard_st: p.standardST,
  daily_target: p.dailyTarget ?? null,
  workers: p.workers ?? null,
  worker: p.worker ?? null,
  equipment_id: p.equipmentId ?? null,
}));

// WORK_END(17:30) 이후 시작이면 야간 — src/lib/worktime.ts의 classifyShift와 같은 규칙.
// (shift 필드가 생기기 전에 만들어진 옛 실적 45건에는 이 값이 없어서, 같은 규칙으로 채워 넣는다.)
function classifyShift(startTime) {
  return startTime >= "17:30" ? "night" : "day";
}

const recordRows = db.records.map((r) => ({
  id: r.id,
  date: r.date,
  process_id: r.processId,
  start_time: r.startTime,
  end_time: r.endTime,
  quantity: r.quantity,
  equipment_id: r.equipmentId,
  worker: r.worker,
  assist_type: r.assistType,
  shift: r.shift ?? classifyShift(r.startTime),
  production_minutes: r.productionMinutes,
  recovered_amount: r.recoveredAmount,
  recovered_note: r.recoveredNote,
  created_at: r.createdAt,
}));

async function upsert(table, rows) {
  if (rows.length === 0) {
    console.log(`- ${table}: 옮길 데이터 없음`);
    return;
  }
  const { error } = await supabase.from(table).upsert(rows);
  if (error) throw new Error(`${table} 이관 실패: ${error.message}`);
  console.log(`- ${table}: ${rows.length}건 완료`);
}

// 참조 순서: teams → equipments → processes → records
await upsert("teams", teamRows);
await upsert("equipments", equipmentRows);
await upsert("processes", processRows);
await upsert("records", recordRows);

console.log("마이그레이션 완료");
