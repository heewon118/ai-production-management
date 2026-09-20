/**
 * 집계 계산
 *
 * PRD 규칙:
 * - 표준ST 비교는 "기간별 평균"으로 본다.
 * - 효과금액은 기본적으로 "전체 누적"이되, 기간을 지정하면 그 기간만 본다.
 *   저장된 스냅샷이 아니라 항상 "지금" 설비 계산식으로 다시 계산한다.
 * 두 기준이 다르므로 함수도 분리해서 관리한다.
 */

import { calcRecoveredAmount } from "./roi";
import type { Database, Equipment, Process, ProductionRecord } from "./types";

/** 공정 id로 공정을 빠르게 찾기 위한 맵 */
export function toProcessMap(processes: Process[]): Map<string, Process> {
  return new Map(processes.map((process) => [process.id, process]));
}

/** 공정의 전체 경로를 "상위 > 하위" 형태 문자열로 만든다. */
export function buildProcessPath(processId: string, processes: Process[]): string {
  const map = toProcessMap(processes);
  const names: string[] = [];
  let current = map.get(processId);
  // 계층은 최대 3단계지만, 데이터가 꼬여 무한 루프가 나지 않도록 횟수를 제한한다.
  let guard = 0;
  while (current && guard < 10) {
    names.unshift(current.name);
    current = current.parentId ? map.get(current.parentId) : undefined;
    guard += 1;
  }
  return names.join(" > ");
}

/** 해당 공정의 최상위(assy) 공정을 찾는다. */
export function findTopProcess(processId: string, processes: Process[]): Process | undefined {
  const map = toProcessMap(processes);
  let current = map.get(processId);
  let guard = 0;
  while (current?.parentId && guard < 10) {
    current = map.get(current.parentId);
    guard += 1;
  }
  return current;
}

/** 파트(1단계)의 콤마 구분 담당자 텍스트를 이름 배열로 바꾼다. (빈 항목은 뺀다) */
export function parseWorkerNames(workersText: string | undefined | null): string[] {
  if (!workersText) return [];
  return workersText
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** 이름 배열을 저장용 콤마 텍스트로 합친다. (중복 제거, 보기 좋게 ", "로 이어붙인다) */
export function joinWorkerNames(names: string[]): string {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].join(", ");
}

/** 이 공정이 속한 파트(1단계)의 담당자 이름 목록을 구한다. */
export function getPartWorkers(processId: string, processes: Process[]): string[] {
  const top = findTopProcess(processId, processes);
  return parseWorkerNames(top?.workers);
}

/**
 * 이 공정이 속한 파트(1단계)의 소속 팀을 구한다.
 * 팀 정보가 없는(마이그레이션 전) 파트는 생산2팀으로 본다.
 */
export function partTeamOf(processId: string, processes: Process[]): string {
  const top = findTopProcess(processId, processes);
  return top?.team ?? "team2";
}

/**
 * 형제 공정들을 order 필드 기준으로 정렬한다.
 * order가 없는 항목은 원래 순서를 유지한 채 뒤로 보낸다(설정한 항목이 우선한다).
 */
export function sortByProcessOrder<T extends { order?: number | null }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const orderA = a.item.order ?? null;
      const orderB = b.item.order ?? null;
      if (orderA === null && orderB === null) return a.index - b.index;
      if (orderA === null) return 1;
      if (orderB === null) return -1;
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** 어떤 공정 아래(2단계 이하)를 트리 순서(형제는 order 반영)로 평평하게 편다. */
function descendantIdsInOrder(processes: Process[], parentId: string): string[] {
  const result: string[] = [];
  const children = sortByProcessOrder(processes.filter((process) => process.parentId === parentId));
  for (const child of children) {
    result.push(child.id);
    result.push(...descendantIdsInOrder(processes, child.id));
  }
  return result;
}

/**
 * 이 팀 소속 파트 전체의 하위 공정을 트리 순서로 평평하게 편다.
 * 파트별 상세가 아니라 팀 전체를 한 표에 늘어놓는 화면(공정별 비교표)에서 쓴다.
 * 팀별로 색을 따로 배정해, 다른 팀 공정 수에 영향받지 않게 한다.
 */
export function teamProcessIdsInOrder(processes: Process[], teamId: string): string[] {
  const parts = sortByProcessOrder(
    processes.filter((process) => process.parentId === null && (process.team ?? "team2") === teamId),
  );
  return parts.flatMap((part) => descendantIdsInOrder(processes, part.id));
}

/** 공정의 단계(1~3)를 구한다. */
export function getProcessLevel(processId: string, processes: Process[]): number {
  const map = toProcessMap(processes);
  let current = map.get(processId);
  let level = 1;
  while (current?.parentId && level < 10) {
    current = map.get(current.parentId);
    level += 1;
  }
  return level;
}

/** 기간(YYYY-MM-DD)으로 실적을 걸러낸다. 값이 비어 있으면 제한하지 않는다. */
export function filterByPeriod(
  records: ProductionRecord[],
  from: string,
  to: string,
): ProductionRecord[] {
  return records.filter((record) => {
    if (from && record.date < from) return false;
    if (to && record.date > to) return false;
    return true;
  });
}

export type ProcessStat = {
  process: Process;
  path: string;
  recordCount: number;
  totalQuantity: number;
  totalMinutes: number;
  /** 개당 실제 ST(초) — 총 생산시간 ÷ 총 수량 (가중 평균) */
  actualST: number | null;
  /** 표준ST(초). 아직 등록 안 했으면 null */
  standardST: number | null;
  /** 표준 대비 차이(%). 양수면 표준보다 오래 걸린 것 */
  diffPercent: number | null;
};

/**
 * 공정별로 기간 평균 실제ST를 구하고 표준ST와 비교한다.
 * 실적이 있는 공정만 결과에 넣는다.
 * excludedFromStats로 표시한 실적(예: 시간이 실제 작업 페이스를 대표하지 않는 자동화 설비
 * 수량 기록)은 이 평균 계산에서 뺀다 — 설비 효과금액 계산에는 별도로 그대로 반영된다.
 */
export function calcProcessStats(
  records: ProductionRecord[],
  processes: Process[],
): ProcessStat[] {
  const map = toProcessMap(processes);
  const grouped = new Map<string, ProductionRecord[]>();

  for (const record of records) {
    if (record.excludedFromStats) continue;
    const list = grouped.get(record.processId) ?? [];
    list.push(record);
    grouped.set(record.processId, list);
  }

  const stats: ProcessStat[] = [];

  for (const [processId, list] of grouped) {
    const process = map.get(processId);
    if (!process) continue; // 공정이 삭제된 경우는 건너뛴다

    const totalQuantity = list.reduce((sum, record) => sum + record.quantity, 0);
    const totalMinutes = list.reduce((sum, record) => sum + record.productionMinutes, 0);

    // 개당 실제 ST(초) = 총 생산시간(분) × 60 ÷ 총 수량
    const actualST = totalQuantity > 0 ? (totalMinutes * 60) / totalQuantity : null;
    // 직접 입력한 값이 없으면 하위 공정 합산을 표준ST로 본다. (파트·공정 화면과 같은 규칙)
    const standardST = effectiveStandardST(processId, processes);

    // 표준ST가 등록된 공정만 차이(%)를 계산한다. (미등록이면 실적만 보여준다)
    const diffPercent =
      actualST !== null && standardST !== null && standardST > 0
        ? ((actualST - standardST) / standardST) * 100
        : null;

    stats.push({
      process,
      path: buildProcessPath(processId, processes),
      recordCount: list.length,
      totalQuantity,
      totalMinutes,
      actualST,
      standardST,
      diffPercent,
    });
  }

  return stats.sort((a, b) => a.path.localeCompare(b.path, "ko"));
}

export type YamazumiSegment = {
  processId: string;
  name: string;
  /** 개당 실제 ST(초) */
  value: number;
};

export type YamazumiGroup = {
  topProcessId: string;
  topProcessName: string;
  segments: YamazumiSegment[];
  /** 막대 전체 높이 (세그먼트 합계, 초) */
  total: number;
  /** 목표선 = 같은 공정들의 표준ST 합계(초). 하나도 등록 안 됐으면 null */
  target: number | null;
};

/**
 * 야마즈미 차트용 데이터를 만든다.
 * 최상위(assy) 공정별로 막대를 만들고, 그 아래 하위 공정들의 실제ST를 쌓아 올린다.
 * 목표선은 같은 공정들의 표준ST 합계다.
 */
export function buildYamazumiData(
  stats: ProcessStat[],
  processes: Process[],
): YamazumiGroup[] {
  const groups = new Map<string, YamazumiGroup>();

  for (const stat of stats) {
    if (stat.actualST === null) continue;

    const top = findTopProcess(stat.process.id, processes) ?? stat.process;
    const existing = groups.get(top.id) ?? {
      topProcessId: top.id,
      topProcessName: top.name,
      segments: [],
      total: 0,
      target: null,
    };

    existing.segments.push({
      processId: stat.process.id,
      // 최상위 공정 자신이면 이름 그대로, 하위 공정이면 마지막 이름만 쓴다.
      name: stat.process.name,
      value: stat.actualST,
    });
    existing.total += stat.actualST;

    if (stat.standardST !== null) {
      existing.target = (existing.target ?? 0) + stat.standardST;
    }

    groups.set(top.id, existing);
  }

  return [...groups.values()].sort((a, b) =>
    a.topProcessName.localeCompare(b.topProcessName, "ko"),
  );
}

/** 어떤 공정이 특정 공정 자신이거나 그 아래(하위)에 속하는지 확인한다. */
export function isDescendantOf(
  processId: string,
  ancestorId: string,
  processes: Process[],
): boolean {
  const map = toProcessMap(processes);
  let current = map.get(processId);
  let guard = 0;
  while (current && guard < 10) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? map.get(current.parentId) : undefined;
    guard += 1;
  }
  return false;
}

/**
 * 공정의 표준ST를 구한다.
 * 직접 입력한 값이 있으면 그 값을, 없으면 하위 공정들의 합산을 쓴다. (파트·공정 화면과 같은 규칙)
 */
export function effectiveStandardST(processId: string, processes: Process[]): number | null {
  const process = toProcessMap(processes).get(processId);
  if (!process) return null;
  if (process.standardST !== null) return process.standardST;

  const children = processes.filter((item) => item.parentId === processId);
  if (children.length === 0) return null;

  let sum = 0;
  let found = false;
  for (const child of children) {
    const value = effectiveStandardST(child.id, processes);
    if (value !== null) {
      sum += value;
      found = true;
    }
  }
  return found ? sum : null;
}

/**
 * 파트(1단계)를 하나 골라, 그 아래 2단계 공정을 가로축으로 하는 야마즈미 데이터를 만든다.
 *
 * 막대는 3단계 공정들의 평균 실제ST를 쌓아 올리고, 그 합계가 2단계 공정의 실제ST가 된다.
 * (하위 공정 실적은 수량 집계가 아니라 ST 평균 데이터로 쓰인다)
 * 3단계 실적이 아직 없으면 2단계 공정 자신에게 입력된 실적을 쓴다.
 */
export function buildYamazumiByPart(
  stats: ProcessStat[],
  processes: Process[],
  partId: string,
): YamazumiGroup[] {
  const secondLevel = sortByProcessOrder(processes.filter((process) => process.parentId === partId));

  return secondLevel
    .map((process) => {
      // 3단계 공정들의 평균 실제ST를 쌓는다.
      const children = processes.filter((item) => item.parentId === process.id);
      const childSegments: YamazumiSegment[] = [];

      for (const child of children) {
        const stat = stats.find((item) => item.process.id === child.id && item.actualST !== null);
        if (stat) {
          childSegments.push({
            processId: child.id,
            name: child.name,
            value: stat.actualST as number,
          });
        }
      }

      // 3단계 실적이 하나도 없으면 2단계 공정 자신의 실적을 쓴다.
      let segments = childSegments;
      if (segments.length === 0) {
        const own = stats.find((stat) => stat.process.id === process.id && stat.actualST !== null);
        segments = own
          ? [{ processId: process.id, name: process.name, value: own.actualST as number }]
          : [];
      }

      return {
        topProcessId: process.id,
        topProcessName: process.name,
        segments,
        total: segments.reduce((sum, segment) => sum + segment.value, 0),
        target: effectiveStandardST(process.id, processes),
      } satisfies YamazumiGroup;
    })
    // 실적도 표준ST도 없는 공정은 보여줄 내용이 없으므로 뺀다.
    .filter((group) => group.segments.length > 0 || group.target !== null);
}

export type EquipmentStat = {
  equipment: Equipment;
  /** 시작 시점 초기 누적액 */
  initialRecovered: number;
  /** 실적을 통해 새로 쌓인 회수액 */
  addedRecovered: number;
  /** 총 누적 회수액 = 초기값 + 쌓인 금액 */
  totalRecovered: number;
  /** 투자비 대비 회수율(%) */
  recoveryRate: number | null;
  /** 남은 금액 (0이면 본전 회수 완료) */
  remaining: number;
  /** 회수액에 반영된 실적 건수 */
  recordCount: number;
  /** 계산식으로 계산하지 못한 실적 건수 (표준ST 미등록 등) */
  pendingCount: number;
};

/**
 * 설비별 ROI(투자비 회수) 현황을 계산한다.
 * ROI는 기간과 무관하게 "전체 누적"으로 본다.
 * 각 실적에 저장된 회수액 스냅샷을 그대로 더하며, 계산식이 바뀌어도 과거 값은 재계산하지 않는다.
 */
export function calcEquipmentStats(
  allRecords: ProductionRecord[],
  equipments: Equipment[],
  processes: Process[],
  range?: { from: string; to: string },
): EquipmentStat[] {
  return equipments.map((equipment) => {
    let related = allRecords.filter((record) => record.equipmentId === equipment.id);

    // 누적 회수액 기준일이 있으면, 그 날짜까지의 실적은 이미 시작 시점 누적값에 반영된
    // 것으로 보고 자동 계산(addedRecovered)에서는 그 다음 날부터의 실적만 센다.
    if (equipment.initialRecoveredUntil) {
      const until = equipment.initialRecoveredUntil;
      related = related.filter((record) => record.date > until);
    }

    if (range) {
      related = related.filter((record) => {
        if (range.from && record.date < range.from) return false;
        if (range.to && record.date > range.to) return false;
        return true;
      });
    }

    // 저장된 회수액 스냅샷은 쓰지 않는다. 계산식이 나중에 바뀌면 과거 실적도
    // 항상 "지금" 설비의 계산식·값으로 다시 계산해서 보여준다.
    let addedRecovered = 0;
    let calculatedCount = 0;
    for (const record of related) {
      const result = calcRecoveredAmount(
        {
          quantity: record.quantity,
          productionMinutes: record.productionMinutes,
          standardST: effectiveStandardST(record.processId, processes),
        },
        equipment,
      );
      if (result.amount !== null) {
        addedRecovered += result.amount;
        calculatedCount += 1;
      }
    }

    const totalRecovered = equipment.initialRecovered + addedRecovered;

    return {
      equipment,
      initialRecovered: equipment.initialRecovered,
      addedRecovered,
      totalRecovered,
      recoveryRate:
        equipment.investmentCost > 0
          ? (totalRecovered / equipment.investmentCost) * 100
          : null,
      remaining: Math.max(equipment.investmentCost - totalRecovered, 0),
      recordCount: calculatedCount,
      pendingCount: related.length - calculatedCount,
    };
  });
}

/**
 * 목표 달성 현황 (일일 목표수량 기준)
 *
 * 생산실적 달성은 "정상 실적" 기준으로 본다.
 * - 정상 실적(주간, 지원·연차대응 표시 없음)만으로 목표를 채우면 → "달성"(초록)
 * - 연차대응(assistType="leave")으로 채운 실적도 정상으로 쳐서 초록에 포함한다.
 *   (연차 결원을 다른 사람이 정상적으로 메꾼 것이므로 경고로 보지 않는다)
 * - 정상만으론 부족하지만, 생산지원(assistType="support")이나 야간(night) 실적을
 *   더해서 채우면 → "달성 (야간작업/지원)"(노랑) — 실제로 보탠 이유만 표시한다.
 * - 그래도 부족하면 → "미달성"(빨강)
 *
 * 생산수량은 2단계 공정 기준이므로, 해당 공정에 직접 입력된 실적만 센다.
 * (하위 공정 실적은 세지 않는다 — 야마즈미 규칙과 동일)
 */
export type AchievementStatus = "green" | "yellow" | "red" | "no-target";

export type AchievementResult = {
  /** 기간의 시작~끝 (YYYY-MM-DD) */
  from: string;
  to: string;
  /** 기간에 포함된 날짜 수 */
  days: number;
  /** 순수 정상 실적 수량 (주간, 지원·연차대응 아님) */
  normalQuantity: number;
  /** 연차대응으로 채운 수량 (정상 달성에 포함된다) */
  leaveQuantity: number;
  /** 생산지원으로 채운 수량 (경고 대상) */
  supportQuantity: number;
  /** 야간 실적 수량 (경고 대상) */
  nightQuantity: number;
  /** 위 네 가지 합계 */
  totalQuantity: number;
  /** 일 목표 × 기간 일수. 목표 미설정이면 null */
  target: number | null;
  status: AchievementStatus;
  /** 노랑(달성)일 때, 야간작업이 보탰는지 */
  usedNight: boolean;
  /** 노랑(달성)일 때, 생산지원이 보탰는지 */
  usedSupport: boolean;
};

/** "YYYY-MM-DD"에 일수를 더한 날짜 문자열을 구한다. */
function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  // toISOString()은 UTC 기준이라 한국 시간대(KST, UTC+9)에서는 자정에 하루가 밀린다.
  // 달력 날짜를 다루는 거라 지역(local) 기준 연/월/일을 그대로 조합한다.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 두 날짜(포함) 사이의 일수를 구한다. */
function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

/** 기준 날짜가 속한 주(월요일~일요일)의 시작·끝 날짜를 구한다. */
export function getWeekRange(dateStr: string): { from: string; to: string } {
  const date = new Date(`${dateStr}T00:00:00`);
  const day = date.getDay(); // 0=일요일 ~ 6=토요일
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const from = addDays(dateStr, mondayOffset);
  const to = addDays(from, 6);
  return { from, to };
}

/** 기준 날짜가 속한 달의 1일~말일을 구한다. */
export function getMonthRange(dateStr: string): { from: string; to: string } {
  const [year, month] = dateStr.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

/** 기준 날짜에서 n주 앞/뒤로 옮긴 날짜를 구한다. (음수면 과거) 주간 비교에서 "저번 주"를 구할 때 쓴다. */
export function shiftWeeks(dateStr: string, weeks: number): string {
  return addDays(dateStr, weeks * 7);
}

/**
 * 기준 날짜가 속한 달에서 n개월 앞/뒤로 옮긴 달의 1일 날짜를 구한다. (음수면 과거)
 * 월간 비교에서 "저번 달"을 구할 때 쓴다. (getMonthRange는 일(day)은 보지 않으므로 1일로 통일한다)
 */
export function shiftMonths(dateStr: string, months: number): string {
  const [year, month] = dateStr.split("-").map(Number);
  const total = year * 12 + (month - 1) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}-01`;
}

/**
 * 공정 하나의 목표 달성 현황을 구한다.
 * 생산수량은 이 공정에 "직접" 입력된 실적만 센다 (하위 공정 제외).
 */
export function calcAchievement(
  records: ProductionRecord[],
  process: Pick<Process, "id" | "dailyTarget">,
  from: string,
  to: string,
): AchievementResult {
  const scoped = records.filter(
    (record) => record.processId === process.id && record.date >= from && record.date <= to,
  );

  let normalQuantity = 0;
  let leaveQuantity = 0;
  let supportQuantity = 0;
  let nightQuantity = 0;

  for (const record of scoped) {
    if (record.shift === "night") {
      nightQuantity += record.quantity;
    } else if (record.assistType === "support") {
      supportQuantity += record.quantity;
    } else if (record.assistType === "leave") {
      leaveQuantity += record.quantity;
    } else {
      normalQuantity += record.quantity;
    }
  }

  // 연차대응은 "정상 달성" 취급 — 초록 판정에 포함한다.
  const normalForGreen = normalQuantity + leaveQuantity;
  const totalQuantity = normalForGreen + supportQuantity + nightQuantity;
  const days = daysBetween(from, to);
  const dailyTarget = process.dailyTarget ?? null;
  const target = dailyTarget !== null ? dailyTarget * days : null;

  let status: AchievementStatus;
  let usedNight = false;
  let usedSupport = false;

  if (target === null) {
    status = "no-target";
  } else if (normalForGreen >= target) {
    status = "green";
  } else if (totalQuantity >= target) {
    status = "yellow";
    usedNight = nightQuantity > 0;
    usedSupport = supportQuantity > 0;
  } else {
    status = "red";
  }

  return {
    from,
    to,
    days,
    normalQuantity,
    leaveQuantity,
    supportQuantity,
    nightQuantity,
    totalQuantity,
    target,
    status,
    usedNight,
    usedSupport,
  };
}

/** 화면 표시에 쓰는 숫자 포맷 도우미 */
export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 금액 포맷 (원) */
export function formatMoney(value: number): string {
  return `${formatNumber(Math.round(value))}원`;
}

/**
 * 오늘 날짜(YYYY-MM-DD)를 구한다.
 * `new Date().toISOString()`은 UTC 기준이라, 한국(UTC+9)에서는 자정~오전 9시 사이에
 * 하루 전 날짜가 나오는 문제가 있다. 그래서 지역(local) 기준 연/월/일을 그대로 조합한다.
 */
export function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 어제 날짜(YYYY-MM-DD)를 구한다.
 * 오늘 실적은 아직 다 입력되지 않았을 수 있어서, 대시보드 기본 조회일로 어제를 쓴다.
 */
export function yesterdayLocal(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 데이터 전체에서 실적이 있는 날짜 범위를 구한다. (기간 기본값으로 사용) */
export function getDateRange(db: Database): { from: string; to: string } {
  if (db.records.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { from: today, to: today };
  }
  const dates = db.records.map((record) => record.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}
