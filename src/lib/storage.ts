/**
 * 데이터 저장소 (파일 기반)
 *
 * PRD 범위: "누적 값을 새로고침·재접속 후에도 유지하기 위한 최소한의 데이터 저장(간단한 파일 저장 수준)"
 * 그래서 DB 대신 data/db.json 파일 하나에 전체 데이터를 저장한다.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { EMPTY_DB, type Database } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

/**
 * 동시에 여러 요청이 파일을 쓰면 내용이 깨질 수 있으므로,
 * 쓰기 작업을 순서대로 하나씩 처리하도록 대기열을 둔다.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/** 저장된 데이터를 읽는다. 파일이 없으면 빈 데이터를 돌려준다. */
export async function readDb(): Promise<Database> {
  try {
    const raw = await fs.readFile(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    // 파일이 예전 형식이거나 일부가 비어 있어도 앱이 죽지 않도록 기본값을 채운다.
    return {
      processes: parsed.processes ?? [],
      equipments: parsed.equipments ?? [],
      records: parsed.records ?? [],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ...EMPTY_DB };
    }
    throw error;
  }
}

/** 데이터를 파일에 저장한다. */
async function saveDb(db: Database): Promise<void> {
  await ensureDataDir();
  // 쓰다가 중간에 끊겨 파일이 깨지는 것을 막기 위해 임시 파일에 쓴 뒤 바꿔치기한다.
  const tempFile = `${DB_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(db, null, 2), "utf-8");
  await fs.rename(tempFile, DB_FILE);
}

/**
 * 데이터를 읽어서 수정하고 다시 저장한다.
 * 한 번에 하나씩만 실행되므로 동시에 입력해도 값이 덮어써지지 않는다.
 */
export async function updateDb<T>(updater: (db: Database) => T | Promise<T>): Promise<T> {
  const task = writeQueue.then(async () => {
    const db = await readDb();
    const result = await updater(db);
    await saveDb(db);
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
