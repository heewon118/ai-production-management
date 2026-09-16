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
import { buildColorMap, colorFrom } from "@/lib/colors";
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
  yesterdayLocal,
} from "@/lib/stats";

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [partId, setPartId] = useState("");

  // 팀 탭 — 팀마다 대시보드를 따로 본다. (기존 조립/검사/포장은 생산2팀 소속)
  const [selectedTeam, setSelectedTeam] = useState<string>("team2");

  /** 팀 탭을 바꾸면 파트 선택을 그 팀 기준으로 다시 고르게 한다. */
  function selectTeam(team: string) {
    setSelectedTeam(team);
    setPartId("");
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
   * 기본은 어제(일간) 기준으로 현재 파트의 2단계 공정들을 한눈에 보여준다.
   * 주간/월간은 여러 공정을 한 화면에서 비교하기 어려워, 공정 하나를 골라서 본다.
   */
  const [achievementPeriod, setAchievementPeriod] = useState<"day" | "week" | "month">("day");
  const [achievementDate, setAchievementDate] = useState(DEFAULT_ACHIEVEMENT_DATE);
  const [achievementProcessId, setAchievementProcessId] = useState("");

  // 현재 선택된 파트 아래 2단계 공정들 (목표 달성 현황·야마즈미 둘 다 같은 기준)
  const secondLevelProcesses = useMemo(
    () => (data ? data.processes.filter((process) => process.parentId === selectedPartId) : []),
    [data, selectedPartId],
  );

  const selectedAchievementProcessId =
    achievementProcessId && secondLevelProcesses.some((process) => process.id === achievementProcessId)
      ? achievementProcessId
      : (secondLevelProcesses[0]?.id ?? "");

  const achievementRange = useMemo(() => {
    if (achievementPeriod === "week") return getWeekRange(achievementDate);
    if (achievementPeriod === "month") return getMonthRange(achievementDate);
    return { from: achievementDate, to: achievementDate };
  }, [achievementPeriod, achievementDate]);

  // 일간: 2단계 공정 전부를 한 번에 본다.
  const dailyAchievements = useMemo(() => {
    if (!data || achievementPeriod !== "day") return [];
    return secondLevelProcesses.map((process) => ({
      process,
      result: calcAchievement(data.records, process, achievementRange.from, achievementRange.to),
    }));
  }, [data, achievementPeriod, secondLevelProcesses, achievementRange]);

  // 주간·월간: 고른 공정 하나만 본다.
  const singleAchievement: { process: (typeof secondLevelProcesses)[number]; result: AchievementResult } | null =
    useMemo(() => {
      if (!data || achievementPeriod === "day" || !selectedAchievementProcessId) return null;
      const process = secondLevelProcesses.find((item) => item.id === selectedAchievementProcessId);
      if (!process) return null;
      return {
        process,
        result: calcAchievement(data.records, process, achievementRange.from, achievementRange.to),
      };
    }, [data, achievementPeriod, secondLevelProcesses, selectedAchievementProcessId, achievementRange]);

  // 자동화 설비 효과금액 기간 필터. 비워두면(기본) 전체 누적을 본다.
  // 아직 데이터를 다 입력하지 않은 최근 기간을 빼고 보고 싶을 때 쓴다.
  const [equipmentFrom, setEquipmentFrom] = useState("");
  const [equipmentTo, setEquipmentTo] = useState("");

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

    const colorMap = buildColorMap(data.processes.map((process) => process.id));

    return { periodRecords, processStats, yamazumi, equipmentStats, colorMap };
  }, [data, from, to, selectedPartId, selectedTeam, equipmentFrom, equipmentTo]);

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
        description={`설비별 효과금액입니다. 저장된 값이 아니라 항상 지금 계산식으로 다시 계산하며, ${equipmentFrom || equipmentTo ? "지정한 기간만" : "기간과 상관없이 전체 누적을"} 보여줍니다. 아직 실적 입력이 덜 끝난 기간은 필터로 빼고 볼 수 있습니다.`}
        action={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-ink-muted">실적 입력 시점</label>
            <DateField
              value={equipmentFrom}
              onChange={setEquipmentFrom}
              className="rounded-md border border-line bg-card px-2 py-1 text-ink"
            />
            <span className="text-ink-muted">~</span>
            <DateField
              value={equipmentTo}
              onChange={setEquipmentTo}
              className="rounded-md border border-line bg-card px-2 py-1 text-ink"
            />
            <button
              type="button"
              onClick={() => {
                setEquipmentFrom("");
                setEquipmentTo("");
              }}
              className={`rounded-md px-2 py-1 transition-colors ${
                equipmentFrom || equipmentTo
                  ? "border border-line text-ink-soft hover:text-ink"
                  : "bg-ink text-card font-medium"
              }`}
            >
              전체기간
            </button>
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
        ) : (
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
        )}
      </Card>

      {/* 일일 목표 달성 현황 + 야마즈미를 한 줄에 나란히 (좁은 화면에서는 세로로 쌓인다) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="일일 목표 달성 현황"
          description={
            achievementPeriod === "day"
              ? `${achievementDate} 기준, 현재 파트(${parts.find((part) => part.id === selectedPartId)?.name ?? ""}) 2단계 공정들의 목표수량 달성 여부입니다. (담당자 기준)`
              : `${achievementRange.from} ~ ${achievementRange.to} (${achievementPeriod === "week" ? "주간" : "월간"}) 기준, 고른 공정 하나의 달성 여부입니다.`
          }
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
          ) : achievementPeriod === "day" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {dailyAchievements.map(({ process, result }) => {
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
          ) : (
            <div className="space-y-4">
              <select
                value={selectedAchievementProcessId}
                onChange={(event) => setAchievementProcessId(event.target.value)}
                className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
              >
                {secondLevelProcesses.map((process) => (
                  <option key={process.id} value={process.id}>
                    {process.name}
                  </option>
                ))}
              </select>

              {singleAchievement ? (
                (() => {
                  const style = STATUS_STYLE[singleAchievement.result.status];
                  const result = singleAchievement.result;
                  return (
                    <div className={`rounded-lg border p-4 ${style.box}`}>
                      <p className="text-sm font-medium text-ink">{singleAchievement.process.name}</p>
                      <p className={`tabular mt-1 text-2xl font-semibold ${style.text}`}>
                        {formatNumber(result.totalQuantity)}
                        <span className="text-base font-normal text-ink-muted">
                          {" "}
                          / {result.target === null ? "-" : formatNumber(result.target)}개
                        </span>
                      </p>
                      <p className={`mt-1 text-sm font-medium ${style.text}`}>
                        {achievementLabel(result)}
                      </p>
                      <p className="tabular mt-2 text-xs text-ink-muted">
                        정상 {formatNumber(result.normalQuantity)} · 연차대응{" "}
                        {formatNumber(result.leaveQuantity)} · 지원 {formatNumber(result.supportQuantity)} ·
                        야간 {formatNumber(result.nightQuantity)} · {result.days}일 기준
                        {result.target !== null
                          ? ` (일 목표 ${formatNumber(result.target / result.days)}개 × ${result.days}일)`
                          : ""}
                      </p>
                    </div>
                  );
                })()
              ) : (
                <p className="text-sm text-ink-muted">공정을 선택해주세요.</p>
              )}
            </div>
          )}
        </Card>

        <Card
          title="표준ST 대비 실적 (야마즈미)"
          description="파트를 골라서 봅니다. 가로축은 2단계 공정이며, 생산수량은 2단계 공정 기준입니다(하위 공정 실적은 반영하지 않습니다). 점선은 표준ST(리얼타임), 주황선은 여유율을 더한 목표선입니다."
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
                onChange={setFrom}
                className="rounded-md border border-line bg-card px-2 py-1 text-ink"
              />
              <span className="text-ink-muted">~</span>
              <DateField
                value={to}
                onChange={setTo}
                className="rounded-md border border-line bg-card px-2 py-1 text-ink"
              />
              <button
                type="button"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
                className={`rounded-md px-2 py-1 transition-colors ${
                  from || to
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
                    onClick={() => setPartId(part.id)}
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
            groups={view.yamazumi}
            colorOf={(processId) => colorFrom(view.colorMap, processId)}
            bufferPercent={buffer}
          />

          {/* 범례: 색만으로 구분되지 않도록 이름을 함께 보여준다 */}
          {view.yamazumi.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4">
              {[
                ...new Map(
                  view.yamazumi
                    .flatMap((group) => group.segments)
                    .map((segment) => [segment.processId, segment]),
                ).values(),
              ].map((segment) => (
                <span key={segment.processId} className="flex items-center gap-2 text-xs text-ink-soft">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: colorFrom(view.colorMap, segment.processId) }}
                  />
                  {segment.name}
                </span>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      <Card
        title="공정별 표준ST(여유율 포함) 비교"
        description={`개당 실제ST = 총 생산시간 ÷ 총 생산수량. 표준ST에 여유율 ${buffer}%를 더한 값과 비교합니다. 차이(%)가 양수면 여유율 포함 기준보다 오래 걸린 것입니다.`}
      >
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
                            style={{ backgroundColor: colorFrom(view.colorMap, stat.process.id) }}
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
