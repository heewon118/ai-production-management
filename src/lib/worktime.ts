/**
 * 근무시간 / 생산시간 계산
 *
 * PRD 규칙:
 * 근무시간(08:30~17:30) 중 점심시간과 휴식시간은 생산시간에서 자동으로 제외하고,
 * 결과는 분(分) 단위로 저장한다.
 */

/** 근무 시작 시간 */
export const WORK_START = "08:30";
/** 근무 종료 시간 */
export const WORK_END = "17:30";

export type BreakTime = {
  name: string;
  start: string;
  end: string;
};

/** 생산시간에서 빼야 하는 점심·휴식·정비 시간 */
export const BREAK_TIMES: BreakTime[] = [
  { name: "시작 정비", start: "08:30", end: "08:40" },
  { name: "오전 휴식", start: "10:00", end: "10:10" },
  { name: "점심", start: "11:30", end: "12:30" },
  { name: "오후 휴식", start: "14:00", end: "14:10" },
  { name: "오후 휴식", start: "15:40", end: "15:50" },
  { name: "종료 정비", start: "17:20", end: "17:30" },
];

/** "HH:MM" 문자열을 0시 기준 분(分)으로 바꾼다. */
export function toMinutes(hhmm: string): number {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!matched) {
    throw new Error(`시간 형식이 올바르지 않습니다: "${hhmm}" (HH:MM 형식으로 입력해주세요)`);
  }
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`존재하지 않는 시간입니다: "${hhmm}"`);
  }
  return hour * 60 + minute;
}

/** 분(分)을 "HH:MM" 문자열로 바꾼다. */
export function toTimeString(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 두 시간 구간이 겹치는 길이(분)를 구한다. 겹치지 않으면 0 */
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end > start ? end - start : 0;
}

export type AppliedBreak = BreakTime & {
  /** 실제로 제외된 시간(분) */
  minutes: number;
};

export type WorkTimeResult = {
  /** 시작~끝 전체 시간(분) */
  totalMinutes: number;
  /** 제외된 점심·휴식 시간의 합(분) */
  breakMinutes: number;
  /** 실제 생산시간(분) = 전체 - 휴게 */
  productionMinutes: number;
  /** 어떤 휴게시간이 얼마나 제외됐는지 */
  appliedBreaks: AppliedBreak[];
};

/**
 * 시작시간과 끝시간을 받아, 점심·휴식시간을 제외한 실제 생산시간(분)을 계산한다.
 */
export function calcProductionMinutes(startTime: string, endTime: string): WorkTimeResult {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  if (end <= start) {
    throw new Error("종료시간은 시작시간보다 뒤여야 합니다.");
  }

  const appliedBreaks: AppliedBreak[] = [];
  let breakMinutes = 0;

  for (const breakTime of BREAK_TIMES) {
    const minutes = overlapMinutes(
      start,
      end,
      toMinutes(breakTime.start),
      toMinutes(breakTime.end),
    );
    if (minutes > 0) {
      appliedBreaks.push({ ...breakTime, minutes });
      breakMinutes += minutes;
    }
  }

  const totalMinutes = end - start;
  const productionMinutes = totalMinutes - breakMinutes;

  if (productionMinutes <= 0) {
    throw new Error("휴게시간을 빼고 나면 생산시간이 0분 이하입니다. 시간을 다시 확인해주세요.");
  }

  return { totalMinutes, breakMinutes, productionMinutes, appliedBreaks };
}

/**
 * 이 실적이 주간(day) 실적인지 야간(night) 실적인지 구분한다.
 * 시작시간이 근무 종료시간(17:30) 이후면 야간실적으로 본다.
 */
export function classifyShift(startTime: string): "day" | "night" {
  return toMinutes(startTime) >= toMinutes(WORK_END) ? "night" : "day";
}
