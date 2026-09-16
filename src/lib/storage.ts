/**
 * 데이터 저장소 (Supabase Postgres 기반)
 *
 * 이전에는 data/db.json 파일 하나에 저장했지만, Vercel 같은 서버리스 환경은
 * 파일시스템이 읽기 전용이라 그 방식으로는 저장이 안 된다. 그래서 Supabase의
 * teams/equipments/processes/records 4개 테이블에 저장하도록 바꿨다.
 *
 * readDb()/updateDb()의 사용법은 예전과 완전히 같다 — API 라우트 쪽 코드는
 * 하나도 바꾸지 않아도 된다. updateDb는 넘겨준 함수가 db를 메모리에서
 * 자유롭게 고치게 해주고, 끝나면 "무엇이 바뀌었는지"를 스스로 비교해서
 * 바뀐 행만 Supabase에 반영한다(테이블 전체를 지웠다 다시 쓰지 않는다).
 *
 * 보안: 이 파일은 secret key(RLS 우회)로 접근한다. 편집 권한 검사는 이 파일이
 * 아니라 `requireEditor()`(EDIT_PASSWORD)가 담당하며, 브라우저는 Supabase에
 * 직접 접속하지 않고 항상 우리 API 라우트를 거친다.
 */

import supabaseAdmin from "./supabaseAdmin";
import type { Database, Equipment, Process, ProductionRecord, TeamRecord } from "./types";

/**
 * 같은 서버 인스턴스 안에서 여러 요청이 동시에 들어와도 저장이 겹치지 않도록
 * 쓰기 작업을 순서대로 하나씩 처리한다. (서버리스 환경에서는 인스턴스가 여러 개일 수
 * 있어 완벽한 보장은 아니지만, 예전 파일 기반 방식과 같은 수준의 보호는 된다.)
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/* ── DB 행(snake_case) ↔ 화면 타입(camelCase) 변환 ───────────────────── */

type TeamRow = { id: string; name: string };

function teamFromRow(row: TeamRow): TeamRecord {
  return { id: row.id, name: row.name };
}

type ProcessRow = {
  id: string;
  name: string;
  parent_id: string | null;
  team: string | null;
  standard_st: number | null;
  daily_target: number | null;
  workers: string | null;
  worker: string | null;
  equipment_id: string | null;
};

function processFromRow(row: ProcessRow): Process {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    team: row.team ?? undefined,
    standardST: row.standard_st,
    dailyTarget: row.daily_target,
    workers: row.workers ?? undefined,
    worker: row.worker,
    equipmentId: row.equipment_id,
  };
}

function processToRow(process: Process): ProcessRow {
  return {
    id: process.id,
    name: process.name,
    parent_id: process.parentId,
    team: process.team ?? null,
    standard_st: process.standardST,
    daily_target: process.dailyTarget ?? null,
    workers: process.workers ?? null,
    worker: process.worker ?? null,
    equipment_id: process.equipmentId ?? null,
  };
}

type EquipmentRow = {
  id: string;
  name: string;
  team: string;
  investment_cost: number;
  initial_recovered: number;
  initial_recovered_until: string | null;
  formula: string;
  variables: Equipment["variables"];
};

function equipmentFromRow(row: EquipmentRow): Equipment {
  return {
    id: row.id,
    name: row.name,
    team: row.team,
    investmentCost: row.investment_cost,
    initialRecovered: row.initial_recovered,
    initialRecoveredUntil: row.initial_recovered_until,
    formula: row.formula,
    variables: row.variables,
  };
}

function equipmentToRow(equipment: Equipment): EquipmentRow {
  return {
    id: equipment.id,
    name: equipment.name,
    team: equipment.team,
    investment_cost: equipment.investmentCost,
    initial_recovered: equipment.initialRecovered,
    initial_recovered_until: equipment.initialRecoveredUntil ?? null,
    formula: equipment.formula,
    variables: equipment.variables,
  };
}

type RecordRow = {
  id: string;
  date: string;
  process_id: string;
  start_time: string;
  end_time: string;
  quantity: number;
  equipment_id: string | null;
  worker: string | null;
  assist_type: string | null;
  shift: string;
  production_minutes: number;
  recovered_amount: number | null;
  recovered_note: string | null;
  created_at: string;
};

function recordFromRow(row: RecordRow): ProductionRecord {
  return {
    id: row.id,
    date: row.date,
    processId: row.process_id,
    startTime: row.start_time,
    endTime: row.end_time,
    quantity: row.quantity,
    equipmentId: row.equipment_id,
    worker: row.worker,
    assistType: row.assist_type as ProductionRecord["assistType"],
    shift: row.shift as ProductionRecord["shift"],
    productionMinutes: row.production_minutes,
    recoveredAmount: row.recovered_amount,
    recoveredNote: row.recovered_note,
    createdAt: row.created_at,
  };
}

function recordToRow(record: ProductionRecord): RecordRow {
  return {
    id: record.id,
    date: record.date,
    process_id: record.processId,
    start_time: record.startTime,
    end_time: record.endTime,
    quantity: record.quantity,
    equipment_id: record.equipmentId,
    worker: record.worker,
    assist_type: record.assistType,
    shift: record.shift,
    production_minutes: record.productionMinutes,
    recovered_amount: record.recoveredAmount,
    recovered_note: record.recoveredNote,
    created_at: record.createdAt,
  };
}

/** 저장된 데이터를 전부 읽는다. 아직 아무 테이블에도 데이터가 없으면 빈 데이터를 돌려준다. */
export async function readDb(): Promise<Database> {
  const [teams, equipments, processes, records] = await Promise.all([
    supabaseAdmin.from("teams").select("*"),
    supabaseAdmin.from("equipments").select("*"),
    supabaseAdmin.from("processes").select("*"),
    supabaseAdmin.from("records").select("*"),
  ]);

  for (const result of [teams, equipments, processes, records]) {
    if (result.error) throw new Error(`데이터를 불러오지 못했습니다: ${result.error.message}`);
  }

  return {
    teams: ((teams.data ?? []) as TeamRow[]).map(teamFromRow),
    equipments: ((equipments.data ?? []) as EquipmentRow[]).map(equipmentFromRow),
    processes: ((processes.data ?? []) as ProcessRow[]).map(processFromRow),
    records: ((records.data ?? []) as RecordRow[]).map(recordFromRow),
  };
}

/** id 기준으로 무엇이 새로 생겼는지/바뀌었는지/없어졌는지 비교한다. */
function diffById<T extends { id: string }>(
  before: T[],
  after: T[],
): { upserts: T[]; deletedIds: string[] } {
  const beforeMap = new Map(before.map((item) => [item.id, item]));
  const afterIds = new Set(after.map((item) => item.id));

  const upserts = after.filter((item) => {
    const prev = beforeMap.get(item.id);
    return !prev || JSON.stringify(prev) !== JSON.stringify(item);
  });
  const deletedIds = before.filter((item) => !afterIds.has(item.id)).map((item) => item.id);

  return { upserts, deletedIds };
}

/** db.{teams,equipments,processes,records}를 각각 비교해서 바뀐 부분만 Supabase에 반영한다. */
async function syncDb(before: Database, after: Database): Promise<void> {
  const teamsDiff = diffById(before.teams, after.teams);
  const equipmentsDiff = diffById(before.equipments, after.equipments);
  const processesDiff = diffById(before.processes, after.processes);
  const recordsDiff = diffById(before.records, after.records);

  // 삭제는 참조당하는 쪽(부모)보다 참조하는 쪽(자식)부터 — records → processes → equipments → teams.
  if (recordsDiff.deletedIds.length > 0) {
    await supabaseAdmin.from("records").delete().in("id", recordsDiff.deletedIds);
  }
  if (processesDiff.deletedIds.length > 0) {
    await supabaseAdmin.from("processes").delete().in("id", processesDiff.deletedIds);
  }
  if (equipmentsDiff.deletedIds.length > 0) {
    await supabaseAdmin.from("equipments").delete().in("id", equipmentsDiff.deletedIds);
  }
  if (teamsDiff.deletedIds.length > 0) {
    await supabaseAdmin.from("teams").delete().in("id", teamsDiff.deletedIds);
  }

  // 추가/수정은 참조되는 쪽(부모)부터 — teams → equipments → processes → records.
  // (TeamRecord와 teams 테이블 행은 모양이 같아 따로 변환하지 않는다.)
  if (teamsDiff.upserts.length > 0) {
    const { error } = await supabaseAdmin.from("teams").upsert(teamsDiff.upserts);
    if (error) throw new Error(`팀 저장 실패: ${error.message}`);
  }
  if (equipmentsDiff.upserts.length > 0) {
    const { error } = await supabaseAdmin.from("equipments").upsert(equipmentsDiff.upserts.map(equipmentToRow));
    if (error) throw new Error(`설비 저장 실패: ${error.message}`);
  }
  if (processesDiff.upserts.length > 0) {
    const { error } = await supabaseAdmin.from("processes").upsert(processesDiff.upserts.map(processToRow));
    if (error) throw new Error(`공정 저장 실패: ${error.message}`);
  }
  if (recordsDiff.upserts.length > 0) {
    const { error } = await supabaseAdmin.from("records").upsert(recordsDiff.upserts.map(recordToRow));
    if (error) throw new Error(`생산실적 저장 실패: ${error.message}`);
  }
}

/**
 * 데이터를 읽어서 수정하고 바뀐 부분만 저장한다.
 * 한 번에 하나씩만 실행되므로 같은 인스턴스 안에서는 동시에 입력해도 값이 덮어써지지 않는다.
 */
export async function updateDb<T>(updater: (db: Database) => T | Promise<T>): Promise<T> {
  const task = writeQueue.then(async () => {
    const before = await readDb();
    // updater가 db를 그 자리에서 고치므로, 비교용으로 수정 전 상태를 따로 복제해둔다.
    const working: Database = JSON.parse(JSON.stringify(before));
    const result = await updater(working);
    await syncDb(before, working);
    return result;
  });

  // 앞의 작업이 실패해도 대기열이 멈추지 않도록 에러는 여기서 삼킨다.
  writeQueue = task.catch(() => undefined);

  return task;
}

/** 새 id를 만든다. */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
