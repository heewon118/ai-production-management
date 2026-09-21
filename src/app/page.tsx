"use client";

/**
 * 대시보드
 * - 맨 위: 자동화 설비 효과금액 (전체 누적)
 * - 그 아래: 일일 목표 달성 현황 + 표준ST 대비 실적(야마즈미) — 한 줄에 나란히
 * - 맨 아래: 공정별 표준ST(여유율 포함) 비교
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import Card from "@/components/Card";
import DateField from "@/components/DateField";
import YamazumiChart from "@/components/YamazumiChart";
import { useAppData } from "@/lib/client";
import { buildColorMap, buildYamazumiColorMap, colorFrom } from "@/lib/colors";
import {
  type AchievementResult,
  type AchievementStatus,
  buildYamazumiByPart,
  calcAchievement,
  calcEquipmentStats,
  calcProcessStats,
  filterByPeriod,
  formatMoney,
  formatNumber,
  getMonthRange,
  getWeekRange,
  partTeamOf,
  shiftMonths,
  shiftWeeks,
  teamProcessIdsInOrder,
  todayLocal,
  yesterdayLocal,
} from "@/lib/stats";

/** 실적 날짜 중 가장 이른 날짜를 찾는다. 실적이 없으면 null. */
function earliestDate(records: { date: string }[]): string | null {
  return records.reduce<string | null>((min, record) => (min === null || record.date < min ? record.date : min), null);
}

// 오늘 실적은 아직 다 안 들어와 있을 수 있어서, 기본으로는 어제 기준을 보여준다.
// (나중에 실시간 연동이 되면 오늘 기준으로 바뀔 수 있다)
const DEFAULT_ACHIEVEMENT_DATE = yesterdayLocal();

/** 달성 상태별 색상 스타일 (초록=달성, 노랑=야간작업/지원으로 달성, 빨강=미달성) */
const STATUS_STYLE: Record<AchievementStatus, { box: string; text: string }> = {
  green: { box: "border-good/40 bg-good/10", text: "text-good" },
  yellow: { box: "border-warning/40 bg-warning/10", text: "text-warning" },
  red: { box: "border-critical/40 bg-critical/10", text: "text-critical" },
  "no-target": { box: "border-line bg-page", text: "text-ink-muted" },
};

/** 상태 라벨. 노랑일 때는 야간작업/지원 중 실제로 보탠 이유를 함께 보여준다. */
function achievementLabel(result: AchievementResult): string {
  if (result.status === "green") return "달성";
  if (result.status === "red") return "미달성";
  if (result.status === "no-target") return "목표 미설정";
  const reasons = [result.usedNight ? "야간작업" : null, result.usedSupport ? "지원" : null].filter(
    (reason): reason is string => reason !== null,
  );
  return `달성 (${reasons.join("+")})`;
}

export default function DashboardPage() {
  const { data, loading, error } = useAppData();
  // null이면 "직접 안 골랐다" — 이 팀의 기본 기간(데이터가 실제 있는 첫 날짜 ~ 오늘)을 그대로 쓴다.
  const [fromOverride, setFromOverride] = useState<string | null>(null);
  const [toOverride, setToOverride] = useState<string | null>(null);
  const [partId, setPartId] = useState("");
  // 야마즈미 막대는 기본은 Assy(2단계) 총합계로 보여주고, 누르면 그 Assy의 단위공정(3단계)
  // 내역으로 펼쳐 보여준다. 여기에 펼쳐놓은 Assy id를 담아둔다.
  const [expandedAssyIds, setExpandedAssyIds] = useState<Set<string>>(new Set());

  // 팀 탭 — 팀마다 대시보드를 따로 본다. (기존 조립/검사/포장은 생산2팀 소속)
  const [selectedTeam, setSelectedTeam] = useState<string>("team2");

  /** 팀 탭을 바꾸면 파트 선택과 기간을 그 팀 기준으로 다시 맞춘다. */
  function selectTeam(team: string) {
    setSelectedTeam(team);
    setPartId("");
    setFromOverride(null);
    setToOverride(null);
    setEquipmentFromOverride(null);
    setEquipmentToOverride(null);
    setExpandedAssyIds(new Set());
  }

  /** 파트를 바꾸면 야마즈미 막대의 펼침 상태도 초기화한다. */
  function selectPart(id: string) {
    setPartId(id);
    setExpandedAssyIds(new Set());
  }

  /** 야마즈미 막대를 누르면 그 Assy를 펼치거나 접는다. */
  function toggleAssyExpanded(topProcessId: string) {
    setExpandedAssyIds((prev) => {
      const next = new Set(prev);
      if (next.has(topProcessId)) {
        next.delete(topProcessId);
      } else {
        next.add(topProcessId);
      }
      return next;
    });
  }
  /**
   * 여유율(%) — 표준ST는 실제로 걸리는 시간(리얼타임)이므로 여기에 여유를 더해 목표선으로 본다.
   * 브라우저에 기억해두고 다음에 들어와도 같은 값으로 보여준다.
   */
  const [bufferPercent, setBufferPercent] = useState(() => {
    if (typeof window === "undefined") return "10";
    try {
      return window.localStorage.getItem("yamazumi-buffer") ?? "10";
    } catch {
      return "10";
    }
  });

  function changeBuffer(value: string) {
    setBufferPercent(value);
    try {
      window.localStorage.setItem("yamazumi-buffer", value);
    } catch {
      // 브라우저가 저장을 막아도 화면은 그대로 동작한다.
    }
  }

  // 1단계(파트) 목록 — 야마즈미 차트를 파트별로 나눠 보기 위해 쓴다. 선택한 팀 소속 파트만 본다.
  const parts = useMemo(
    () =>
      data
        ? data.processes.filter(
            (process) => process.parentId === null && (process.team ?? "team2") === selectedTeam,
          )
        : [],
    [data, selectedTeam],
  );

  // 아직 고른 파트가 없으면 첫 번째 파트를 본다.
  const selectedPartId = partId || parts[0]?.id || "";

  /**
   * 목표 달성 현황
   * 일간/주간/월간 모두 현재 파트의 2단계 공정들을 한눈에 보여준다.
   * (목표는 calcAchievement가 "일 목표 × 기간 일수"로 이미 기간에 맞춰 계산해준다)
   */
  const [achievementPeriod, setAchievementPeriod] = useState<"day" | "week" | "month">("day");
  const [achievementDate, setAchievementDate] = useState(DEFAULT_ACHIEVEMENT_DATE);

  // 현재 선택된 파트 아래 2단계 공정들 (목표 달성 현황·야마즈미 둘 다 같은 기준)
  const secondLevelProcesses = useMemo(
    () => (data ? data.processes.filter((process) => process.parentId === selectedPartId) : []),
    [data, selectedPartId],
  );

  const achievementRange = useMemo(() => {
    if (achievementPeriod === "week") return getWeekRange(achievementDate);
    if (achievementPeriod === "month") return getMonthRange(achievementDate);
    return { from: achievementDate, to: achievementDate };
  }, [achievementPeriod, achievementDate]);

  // 2단계 공정 전부를 한 번에 본다 (일간/주간/월간 공통).
  const periodAchievements = useMemo(() => {
    if (!data) return [];
    return secondLevelProcesses.map((process) => ({
      process,
      result: calcAchievement(data.records, process, achievementRange.from, achievementRange.to),
    }));
  }, [data, secondLevelProcesses, achievementRange]);

  // 자동화 설비 효과금액 기간 필터. "전체기간"을 누르면 이 팀의 데이터가 실제 있는
  // 첫 날짜 ~ 오늘로 되돌아간다(그 범위 안에 모든 실적이 들어있으므로 전체 누적과 같다).
  const [equipmentFromOverride, setEquipmentFromOverride] = useState<string | null>(null);
  const [equipmentToOverride, setEquipmentToOverride] = useState<string | null>(null);

  /**
   * 전체 누적 대신 주간/월간으로 볼 수도 있다. 이때는 "이번 기간"과 "저번 기간"을
   * 함께 계산해서 얼마나 늘었는지(증감) 비교해서 보여준다. 기준 날짜는 이전/다음으로 옮겨볼 수 있다.
   */
  const [equipmentPeriodMode, setEquipmentPeriodMode] = useState<"all" | "week" | "month">("all");
  const [equipmentPeriodDate, setEquipmentPeriodDate] = useState(todayLocal());

  // 선택한 팀 소속 실적만으로 "데이터가 실제 있는 첫 날짜"를 구한다.
  const teamRecordsForRange = useMemo(
    () => (data ? data.records.filter((record) => partTeamOf(record.processId, data.processes) === selectedTeam) : []),
    [data, selectedTeam],
  );
  const defaultRange = useMemo(() => {
    const today = todayLocal();
    return { from: earliestDate(teamRecordsForRange) ?? today, to: today };
  }, [teamRecordsForRange]);

  // 직접 고른 값이 있으면 그 값을, 없으면 이 팀의 기본 기간(전체기간)을 쓴다.
  const from = fromOverride ?? defaultRange.from;
  const to = toOverride ?? defaultRange.to;
  const equipmentFrom = equipmentFromOverride ?? defaultRange.from;
  const equipmentTo = equipmentToOverride ?? defaultRange.to;

  const view = useMemo(() => {
    if (!data) return null;

    // 선택한 팀 소속 공정·실적·설비만 본다.
    const teamRecords = data.records.filter(
      (record) => partTeamOf(record.processId, data.processes) === selectedTeam,
    );
    const teamEquipments = data.equipments.filter(
      (equipment) => (equipment.team ?? "team2") === selectedTeam,
    );

    // 표준ST 비교는 "기간 평균" 기준
    const periodRecords = filterByPeriod(teamRecords, from, to);
    const processStats = calcProcessStats(periodRecords, data.processes);
    // 야마즈미는 고른 파트 아래 2단계 공정을 가로축으로 그린다.
    const yamazumi = selectedPartId
      ? buildYamazumiByPart(processStats, data.processes, selectedPartId)
      : [];

    // 자동화 설비 효과금액은 기본 "전체 누적"이며, 기간을 지정하면 그 기간만 본다.
    // 저장된 값이 아니라 항상 지금 설비 계산식으로 다시 계산한다.
    const equipmentStats = calcEquipmentStats(
      teamRecords,
      teamEquipments,
      data.processes,
      equipmentFrom || equipmentTo ? { from: equipmentFrom, to: equipmentTo } : undefined,
    );

    // 주간/월간 모드면 "이번 기간"과 "저번 기간"을 함께 계산해서 증감을 비교할 수 있게 한다.
    let equipmentCompare: {
      currentRange: { from: string; to: string };
      previousRange: { from: string; to: string };
      current: typeof equipmentStats;
      previous: typeof equipmentStats;
    } | null = null;
    if (equipmentPeriodMode !== "all") {
      const currentRange =
        equipmentPeriodMode === "week"
          ? getWeekRange(equipmentPeriodDate)
          : getMonthRange(equipmentPeriodDate);
      const previousRange =
        equipmentPeriodMode === "week"
          ? getWeekRange(shiftWeeks(equipmentPeriodDate, -1))
          : getMonthRange(shiftMonths(equipmentPeriodDate, -1));
      equipmentCompare = {
        currentRange,
        previousRange,
        current: calcEquipmentStats(teamRecords, teamEquipments, data.processes, currentRange),
        previous: calcEquipmentStats(teamRecords, teamEquipments, data.processes, previousRange),
      };
    }

    // 공정별 비교표는 팀 전체를 한 표에 늘어놓으므로, 팀 안에서 순서대로 색을 배정한다.
    const tableColorMap = buildColorMap(teamProcessIdsInOrder(data.processes, selectedTeam));

    return { periodRecords, processStats, yamazumi, equipmentStats, equipmentCompare, tableColorMap };
  }, [
    data,
    from,
    to,
    selectedPartId,
    selectedTeam,
    equipmentFrom,
    equipmentTo,
    equipmentPeriodMode,
    equipmentPeriodDate,
  ]);

  /**
   * 야마즈미 막대는 기본으로 Assy(2단계)별 총합계 하나만 보여준다. expandedAssyIds에 있는
   * Assy만 단위공정(3단계) 내역으로 펼친다. 색은 "지금 실제로 보이는" 구간 기준으로 다시 매겨서,
   * 펼치고 접어도 항상 서로 겹치지 않게 한다.
   */
  const displayYamazumi = useMemo(() => {
    if (!view) return [];
    return view.yamazumi.map((group) => {
      const hasBreakdown = group.segments.some((segment) => segment.processId !== group.topProcessId);
      if (!hasBreakdown || expandedAssyIds.has(group.topProcessId)) return group;
      // 접힌 기본 상태는 공정 자신의 실적(ownTotal)을 우선 보여준다. 자신에게 직접 찍힌
      // 실적이 없으면(단위공정 실적만 있으면) 그 합계(total)를 대신 보여준다.
      const collapsedValue = group.ownTotal ?? group.total;
      return {
        ...group,
        segments: [{ processId: group.topProcessId, name: group.topProcessName, value: collapsedValue }],
        total: collapsedValue,
      };
    });
  }, [view, expandedAssyIds]);

  /** 눌러서 펼쳐볼 단위공정 내역이 실제로 있는 Assy id만 모은다. */
  const expandableAssyIds = useMemo(() => {
    if (!view) return new Set<string>();
    return new Set(
      view.yamazumi
        .filter((group) => group.segments.some((segment) => segment.processId !== group.topProcessId))
        .map((group) => group.topProcessId),
    );
  }, [view]);

  const chartColorMap = useMemo(() => buildYamazumiColorMap(displayYamazumi), [displayYamazumi]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-ink-muted">불러오는 중…</p>;
  }
  if (error || !data || !view) {
    return <p className="py-12 text-center text-sm text-critical">{error ?? "오류가 발생했습니다."}</p>;
  }

  const hasAnything =
    parts.length > 0 ||
    data.records.some((record) => partTeamOf(record.processId, data.processes) === selectedTeam);
  const buffer = Number(bufferPercent) || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-ink-muted">팀</span>
        {data.teams.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => selectTeam(team.id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              selectedTeam === team.id
                ? "bg-ink text-card font-medium"
                : "border border-line text-ink-soft hover:text-ink"
            }`}
          >
            {team.name}
          </button>
        ))}
      </div>

      {!hasAnything ? (
        <div className="rounded-xl border border-line bg-card p-6">
          <h2 className="text-base font-semibold text-ink">처음 시작하기</h2>
          <ol className="mt-3 space-y-2 text-sm text-ink-soft">
            <li>
              1. 오른쪽 위 <strong>편집하기</strong>에 비밀번호를 입력해 편집 모드로 바꿉니다.
            </li>
            <li>
              2. <Link href="/processes" className="underline">공정 설정</Link> 에서 공정을 등록하고
              표준ST(초/개)를 입력합니다.
            </li>
            <li>
              3. <Link href="/equipments" className="underline">자동화 설비 설정</Link> 에서 설비와 효과금액
              계산식을 등록합니다. (선택)
            </li>
            <li>
              4. <Link href="/production" className="underline">생산실적입력</Link> 에서 실적을 입력하면 이
              화면에 결과가 나타납니다.
            </li>
          </ol>
        </div>
      ) : null}

      <Card
        title="자동화 설비 효과금액"
        action={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {(["all", "week", "month"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setEquipmentPeriodMode(mode)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  equipmentPeriodMode === mode
                    ? "bg-ink text-card font-medium"
                    : "border border-line text-ink-soft hover:text-ink"
                }`}
              >
                {mode === "all" ? "전체" : mode === "week" ? "주간" : "월간"}
              </button>
            ))}

            <span className="text-ink-muted">|</span>

            {equipmentPeriodMode === "all" ? (
              <>
                <label className="text-ink-muted">실적 입력 시점</label>
                <DateField
                  value={equipmentFrom}
                  onChange={setEquipmentFromOverride}
                  className="rounded-md border border-line bg-card px-2 py-1 text-ink"
                />
                <span className="text-ink-muted">~</span>
                <DateField
                  value={equipmentTo}
                  onChange={setEquipmentToOverride}
                  className="rounded-md border border-line bg-card px-2 py-1 text-ink"
                />
                <button
                  type="button"
                  onClick={() => {
                    setEquipmentFromOverride(null);
                    setEquipmentToOverride(null);
                  }}
                  className={`rounded-md px-2 py-1 transition-colors ${
                    equipmentFromOverride !== null || equipmentToOverride !== null
                      ? "border border-line text-ink-soft hover:text-ink"
                      : "bg-ink text-card font-medium"
                  }`}
                >
                  전체기간
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setEquipmentPeriodDate((current) =>
                      equipmentPeriodMode === "week" ? shiftWeeks(current, -1) : shiftMonths(current, -1),
                    )
                  }
                  className="rounded-md border border-line px-2 py-1 text-ink-soft hover:text-ink"
                >
                  ◀ 이전{equipmentPeriodMode === "week" ? " 주" : " 달"}
                </button>
                <span className="tabular text-ink-soft">
                  {view.equipmentCompare
                    ? `${view.equipmentCompare.currentRange.from} ~ ${view.equipmentCompare.currentRange.to}`
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEquipmentPeriodDate((current) =>
                      equipmentPeriodMode === "week" ? shiftWeeks(current, 1) : shiftMonths(current, 1),
                    )
                  }
                  className="rounded-md border border-line px-2 py-1 text-ink-soft hover:text-ink"
                >
                  다음{equipmentPeriodMode === "week" ? " 주" : " 달"} ▶
                </button>
                <button
                  type="button"
                  onClick={() => setEquipmentPeriodDate(todayLocal())}
                  className="rounded-md border border-line px-2 py-1 text-ink-soft hover:text-ink"
                >
                  오늘
                </button>
              </>
            )}
          </div>
        }
      >
        {view.equipmentStats.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            등록된 자동화 설비가 없습니다.{" "}
            <Link href="/equipments" className="underline">
              설비 등록하기
            </Link>
          </p>
        ) : equipmentPeriodMode === "all" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {view.equipmentStats.map((stat) => (
              <div key={stat.equipment.id} className="rounded-lg border border-line p-4">
                <h3 className="font-medium text-ink">{stat.equipment.name}</h3>

                <p className="tabular mt-2 text-2xl font-semibold text-good">
                  {stat.totalRecovered >= 0 ? "+" : ""}
                  {formatMoney(stat.totalRecovered)}
                </p>
                <p className="text-xs text-ink-muted">총 효과금액</p>

                <dl className="tabular mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">시작 시점 값</dt>
                    <dd className="text-ink-soft">{formatMoney(stat.initialRecovered)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">실적으로 쌓인 금액</dt>
                    <dd className="text-ink-soft">
                      {stat.addedRecovered >= 0 ? "+" : ""}
                      {formatMoney(stat.addedRecovered)} ({stat.recordCount}건)
                    </dd>
                  </div>
                </dl>

                {stat.pendingCount > 0 ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    계산하지 못한 실적 {stat.pendingCount}건이 있습니다. (표준ST 미등록 또는 계산식
                    오류)
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(view.equipmentCompare?.current ?? []).map((stat) => {
              const previous = view.equipmentCompare?.previous.find(
                (item) => item.equipment.id === stat.equipment.id,
              );
              const previousAdded = previous?.addedRecovered ?? 0;
              const delta = stat.addedRecovered - previousAdded;
              const deltaPercent = previousAdded !== 0 ? (delta / Math.abs(previousAdded)) * 100 : null;
              const periodLabel = equipmentPeriodMode === "week" ? "주" : "달";

              return (
                <div key={stat.equipment.id} className="rounded-lg border border-line p-4">
                  <h3 className="font-medium text-ink">{stat.equipment.name}</h3>

                  <p className="tabular mt-2 text-2xl font-semibold text-good">
                    {stat.addedRecovered >= 0 ? "+" : ""}
                    {formatMoney(stat.addedRecovered)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    이번 {periodLabel} 효과금액 ({stat.recordCount}건)
                  </p>

                  <dl className="tabular mt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">저번 {periodLabel}</dt>
                      <dd className="text-ink-soft">
                        {previousAdded >= 0 ? "+" : ""}
                        {formatMoney(previousAdded)} ({previous?.recordCount ?? 0}건)
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">증감</dt>
                      <dd
                        className="font-medium"
                        style={{ color: delta >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                      >
                        {delta >= 0 ? "+" : ""}
                        {formatMoney(delta)}
                        {deltaPercent !== null
                          ? ` (${delta >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}%)`
                          : ""}
                      </dd>
                    </div>
                  </dl>

                  {stat.pendingCount > 0 ? (
                    <p className="mt-3 text-xs text-ink-muted">
                      계산하지 못한 실적 {stat.pendingCount}건이 있습니다. (표준ST 미등록 또는 계산식
                      오류)
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 일일 목표 달성 현황 + 야마즈미를 한 줄에 나란히 (좁은 화면에서는 세로로 쌓인다) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="일일 목표 달성 현황"
          action={
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {(["day", "week", "month"] as const).map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setAchievementPeriod(period)}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    achievementPeriod === period
                      ? "bg-ink text-card font-medium"
                      : "border border-line text-ink-soft hover:text-ink"
                  }`}
                >
                  {period === "day" ? "일간" : period === "week" ? "주간" : "월간"}
                </button>
              ))}
              <DateField
                value={achievementDate}
                onChange={setAchievementDate}
                className="rounded-md border border-line bg-card px-2 py-1 text-ink"
              />
            </div>
          }
        >
          {secondLevelProcesses.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              이 파트에 2단계 공정이 없습니다. 공정 설정 화면에서 만들어주세요.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {periodAchievements.map(({ process, result }) => {
                const style = STATUS_STYLE[result.status];
                return (
                  <div key={process.id} className={`rounded-lg border p-3 ${style.box}`}>
                    <p className="text-sm font-medium text-ink">{process.name}</p>
                    <p className={`tabular mt-1 text-xl font-semibold ${style.text}`}>
                      {formatNumber(result.totalQuantity)}
                      <span className="text-sm font-normal text-ink-muted">
                        {" "}
                        / {result.target === null ? "-" : formatNumber(result.target)}개
                      </span>
                    </p>
                    <p className={`mt-1 text-xs font-medium ${style.text}`}>
                      {achievementLabel(result)}
                      {achievementPeriod !== "day" ? ` · ${result.days}일 기준` : ""}
                    </p>
                    {result.leaveQuantity > 0 || result.nightQuantity > 0 || result.supportQuantity > 0 ? (
                      <p className="tabular mt-1 text-xs text-ink-muted">
                        정상 {formatNumber(result.normalQuantity)}
                        {result.leaveQuantity > 0
                          ? ` · 연차대응 ${formatNumber(result.leaveQuantity)}`
                          : ""}
                        {result.supportQuantity > 0 ? ` · 지원 ${formatNumber(result.supportQuantity)}` : ""}
                        {result.nightQuantity > 0 ? ` · 야간 ${formatNumber(result.nightQuantity)}` : ""}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="표준ST 대비 실적 (야마즈미)"
          action={
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="text-ink-muted">여유율</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={bufferPercent}
                  onChange={(event) => changeBuffer(event.target.value)}
                  className="tabular w-16 rounded-md border border-line bg-card px-2 py-1 text-right text-ink"
                />
                <span className="text-ink-muted">%</span>
              </div>

              <span className="text-ink-muted">|</span>

              <label className="text-ink-muted">기간</label>
              <DateField
                value={from}
                onChange={setFromOverride}
                className="rounded-md border border-line bg-card px-2 py-1 text-ink"
              />
              <span className="text-ink-muted">~</span>
              <DateField
                value={to}
                onChange={setToOverride}
                className="rounded-md border border-line bg-card px-2 py-1 text-ink"
              />
              <button
                type="button"
                onClick={() => {
                  setFromOverride(null);
                  setToOverride(null);
                }}
                className={`rounded-md px-2 py-1 transition-colors ${
                  fromOverride !== null || toOverride !== null
                    ? "border border-line text-ink-soft hover:text-ink"
                    : "bg-ink text-card font-medium"
                }`}
              >
                전체기간
              </button>
            </div>
          }
        >
          {/* 파트 선택 — 조립 / 검사 / 포장을 따로 본다 */}
          {parts.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-1">
              {parts.map((part) => {
                const active = part.id === selectedPartId;
                return (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => selectPart(part.id)}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-ink text-card font-medium"
                        : "border border-line text-ink-soft hover:text-ink"
                    }`}
                  >
                    {part.name}
                  </button>
                );
              })}
            </div>
          ) : null}

          <YamazumiChart
            groups={displayYamazumi}
            colorOf={(processId) => colorFrom(chartColorMap, processId)}
            bufferPercent={buffer}
            onToggleGroup={toggleAssyExpanded}
            expandableIds={expandableAssyIds}
          />
          {expandableAssyIds.size > 0 ? (
            <p className="mt-2 text-xs text-ink-muted">
              막대를 누르면 단위공정 내역으로 펼쳐 볼 수 있습니다. (▸ 총합계 · ▾ 단위공정 내역)
            </p>
          ) : null}

          {/* 범례: 색만으로 구분되지 않도록 이름을 함께 보여준다 */}
          {displayYamazumi.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4">
              {[
                ...new Map(
                  displayYamazumi
                    .flatMap((group) => group.segments)
                    .map((segment) => [segment.processId, segment]),
                ).values(),
              ].map((segment) => (
                <span key={segment.processId} className="flex items-center gap-2 text-xs text-ink-soft">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: colorFrom(chartColorMap, segment.processId) }}
                  />
                  {segment.name}
                </span>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      <Card title="공정별 표준ST(여유율 포함) 비교">
        {view.processStats.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">선택한 기간에 실적이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="pb-2 font-medium">공정</th>
                  <th className="pb-2 text-right font-medium">실적 건수</th>
                  <th className="pb-2 text-right font-medium">총 수량</th>
                  <th className="pb-2 text-right font-medium">총 생산시간</th>
                  <th className="pb-2 text-right font-medium">실제ST</th>
                  <th className="pb-2 text-right font-medium">표준ST(여유율 포함)</th>
                  <th className="pb-2 text-right font-medium">차이</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {view.processStats.map((stat) => {
                  // 표준ST에 여유율을 더한 값을 기준으로 비교한다.
                  const bufferedST = stat.standardST === null ? null : stat.standardST * (1 + buffer / 100);
                  const bufferedDiff =
                    stat.actualST !== null && bufferedST !== null && bufferedST > 0
                      ? ((stat.actualST - bufferedST) / bufferedST) * 100
                      : null;

                  return (
                    <tr key={stat.process.id} className="border-b border-line/60">
                      <td className="py-2 pr-3 text-ink">
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-sm"
                            style={{ backgroundColor: colorFrom(view.tableColorMap, stat.process.id) }}
                          />
                          {stat.path}
                        </span>
                      </td>
                      <td className="py-2 text-right text-ink-soft">{stat.recordCount}건</td>
                      <td className="py-2 text-right text-ink-soft">
                        {formatNumber(stat.totalQuantity)}개
                      </td>
                      <td className="py-2 text-right text-ink-soft">
                        {formatNumber(stat.totalMinutes)}분
                      </td>
                      <td className="py-2 text-right text-ink">
                        {stat.actualST === null ? "-" : `${stat.actualST.toFixed(1)}초`}
                      </td>
                      <td className="py-2 text-right text-ink-soft">
                        {bufferedST === null ? (
                          <span className="text-ink-muted">미등록</span>
                        ) : (
                          `${bufferedST.toFixed(1)}초`
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {bufferedDiff === null ? (
                          <span className="text-ink-muted">-</span>
                        ) : (
                          <span
                            className="font-medium"
                            style={{
                              color:
                                bufferedDiff > 0 ? "var(--status-critical)" : "var(--status-good)",
                            }}
                          >
                            {bufferedDiff > 0 ? "+" : ""}
                            {bufferedDiff.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
