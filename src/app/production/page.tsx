"use client";

/**
 * 생산실적 입력 / 이력 조회
 *
 * 시작시간과 종료시간을 넣으면 점심·휴식시간을 자동으로 빼고 실제 생산시간(분)을 계산한다.
 * 입력 순서: 파트 선택 → 담당자 선택(그 담당자의 전담 공정만 보임) → 공정 → 시간 → 수량.
 */

import { useMemo, useState } from "react";
import Card from "@/components/Card";
import { apiSend, useAppData } from "@/lib/client";
import { calcRecordRecovery } from "@/lib/records";
import {
  buildProcessPath,
  effectiveStandardST,
  formatMoney,
  formatNumber,
  getProcessLevel,
  isDescendantOf,
  joinWorkerNames,
  parseWorkerNames,
  todayLocal,
} from "@/lib/stats";
import type { AssistType, Database, ProductionRecord } from "@/lib/types";
import { BREAK_TIMES, calcProductionMinutes, WORK_END, WORK_START } from "@/lib/worktime";

const TODAY = todayLocal();

/** 실적 입력의 기본 단계 (최상위 파트 다음 단계) */
const DEFAULT_LEVEL = 2;

/** "HH:MM"(24시간) → 12시간제로 바꾼다. */
function to12Hour(value: string): { hour12: number; minute: number; isPM: boolean } {
  const [h, m] = value.split(":").map(Number);
  const hour = Number.isFinite(h) ? h : 0;
  const minute = Number.isFinite(m) ? m : 0;
  const isPM = hour >= 12;
  let hour12 = hour % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, isPM };
}

/** 12시간제(시/분/오전·오후) → "HH:MM"(24시간)으로 바꾼다. */
function to24Hour(hour12: number, minute: number, isPM: boolean): string {
  let hour = hour12 % 12;
  if (isPM) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * 입력한 숫자(1~4자리)를 시/분으로 해석한다. (예: "0830" → 8시 30분, "830" → 8시 30분)
 *
 * 1~11시는 오전/오후 둘 다 될 수 있는 애매한 값이라, 지금 선택돼 있는 오전/오후를 그대로 따른다.
 * (예: 오후가 선택된 상태에서 "230"을 치면 오전 2:30이 아니라 오후 2:30이 된다)
 * 0시·12시·13~23시는 24시간 기준으로 이미 명확하므로 그대로 쓴다. (예: "1430" → 항상 오후 2:30)
 */
function parseDigits(digits: string, currentIsPM: boolean): { hour: number; minute: number } {
  let hour: number;
  let minute: number;

  if (digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else if (digits.length === 3) {
    hour = Number(digits.slice(0, 1));
    minute = Number(digits.slice(1));
  } else {
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2));
  }

  hour = Math.min(23, hour);
  minute = Math.min(59, minute);

  if (hour >= 1 && hour <= 11 && currentIsPM) {
    hour += 12;
  }

  return { hour, minute };
}

/**
 * 숫자를 연속으로 이어 칠 수 있는 시간 입력칸. (예: "0830" 입력 → 8:30, "1340" 입력 → 오후 1:40)
 * 오전/오후는 옆의 글씨를 누르면 바뀐다.
 */
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { hour12, minute, isPM } = to12Hour(value);
  // 편집 중이 아닐 때는 "8:30"처럼 보기 좋게 보여준다.
  const formatted = `${hour12}:${String(minute).padStart(2, "0")}`;

  // 입력 중에는 실제로 친 숫자만 담아둔다. null이면 "편집 중이 아님" (formatted를 보여준다).
  const [draft, setDraft] = useState<string | null>(null);

  function commit(digits: string) {
    if (!digits) return;
    const { hour, minute: nextMinute } = parseDigits(digits, isPM);
    onChange(`${String(hour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`);
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          value={draft ?? formatted}
          placeholder="0830"
          onFocus={() => setDraft("")}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
            // 4자리를 다 채우면 바로 반영하고, 화면도 곧장 "8:30" 형태로 바꿔 보여준다.
            if (digits.length === 4) {
              commit(digits);
              setDraft(null);
            } else {
              setDraft(digits);
            }
          }}
          onBlur={() => {
            commit(draft ?? "");
            setDraft(null);
          }}
          className="tabular w-20 rounded-md border border-line bg-card px-2 py-2 text-center text-sm text-ink"
        />
        {/* 이 글씨를 누르면 오전/오후가 바뀐다 */}
        <button
          type="button"
          onClick={() => onChange(to24Hour(hour12, minute, !isPM))}
          className={`rounded-md border border-line px-2 py-2 text-sm font-medium ${
            isPM ? "bg-ink text-card" : "text-ink-soft"
          }`}
        >
          {isPM ? "오후" : "오전"}
        </button>
      </div>
    </label>
  );
}

/** 지원구분 라벨 */
const ASSIST_LABEL: Record<"support" | "leave", string> = {
  support: "생산지원",
  leave: "연차대응",
};

export default function ProductionPage() {
  const { data, loading, error, reload } = useAppData();
  const [date, setDate] = useState(TODAY);

  // 파트를 가장 먼저 고른다.
  const [partId, setPartId] = useState("");

  const [processId, setProcessId] = useState("");
  const [processQuery, setProcessQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [showSubProcess, setShowSubProcess] = useState(false);
  const [startTime, setStartTime] = useState(WORK_START);
  const [endTime, setEndTime] = useState(WORK_END);
  /** 생산수량 기본값 (수정 가능) */
  const [quantity, setQuantity] = useState("25");
  const [worker, setWorker] = useState("");
  const [assistType, setAssistType] = useState<"" | "support" | "leave">("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 입력 중인 시간으로 실제 생산시간을 미리 계산해 보여준다.
  const preview = useMemo(() => {
    try {
      return { result: calcProductionMinutes(startTime, endTime), error: null };
    } catch (caught) {
      return {
        result: null,
        error: caught instanceof Error ? caught.message : "시간을 확인해주세요.",
      };
    }
  }, [startTime, endTime]);

  // 파트(1단계) 목록
  const parts = useMemo(
    () => (data ? data.processes.filter((process) => process.parentId === null) : []),
    [data],
  );
  const selectedPartId = partId || parts[0]?.id || "";

  // 선택된 파트에 등록된 담당자 이름 목록
  const partWorkers = useMemo(() => {
    const part = parts.find((item) => item.id === selectedPartId);
    return parseWorkerNames(part?.workers);
  }, [parts, selectedPartId]);

  const processOptions = useMemo(() => {
    if (!data) return [];
    return data.processes
      .map((process) => {
        // 이 공정이 속한 최상위(파트) id를 구한다.
        const map = new Map(data.processes.map((item) => [item.id, item]));
        let current = map.get(process.id);
        let guard = 0;
        while (current?.parentId && guard < 10) {
          current = map.get(current.parentId);
          guard += 1;
        }
        return {
          id: process.id,
          path: buildProcessPath(process.id, data.processes),
          // 직접 넣은 값이 없으면 하위 공정 합산을 표준ST로 본다. (파트·공정 화면과 같은 규칙)
          standardST: effectiveStandardST(process.id, data.processes),
          level: getProcessLevel(process.id, data.processes),
          equipmentId: process.equipmentId ?? null,
          worker: process.worker ?? null,
          topId: current?.id ?? process.id,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path, "ko"));
  }, [data]);

  /**
   * 고를 수 있는 공정 목록.
   * - 선택된 파트 아래 공정만 본다.
   * - 담당자를 골랐으면, 그 담당자가 전담인 2단계 공정(과, 체크 시 그 하위)만 본다.
   * - 담당자를 안 골랐으면 기본은 2단계 공정만, "하위공정 별도입력"을 켜면 그 아래 단계까지 본다.
   */
  const ownerOptions = useMemo(
    () =>
      worker
        ? processOptions.filter(
            (option) => option.level === 2 && option.worker === worker && option.topId === selectedPartId,
          )
        : [],
    [processOptions, worker, selectedPartId],
  );

  const visibleOptions = useMemo(() => {
    const keyword = processQuery.trim().toLowerCase();
    return processOptions.filter((option) => {
      if (option.topId !== selectedPartId) return false;

      if (worker) {
        const isOwn = ownerOptions.some((owner) => owner.id === option.id);
        const isDescendant =
          showSubProcess &&
          data !== null &&
          ownerOptions.some((owner) => isDescendantOf(option.id, owner.id, data.processes));
        if (!isOwn && !isDescendant) return false;
      } else {
        const levelOk = showSubProcess ? option.level >= DEFAULT_LEVEL : option.level === DEFAULT_LEVEL;
        if (!levelOk) return false;
      }

      if (!keyword) return true;
      return option.path.toLowerCase().includes(keyword);
    });
  }, [processOptions, processQuery, showSubProcess, selectedPartId, worker, ownerOptions, data]);

  const selectedProcess = processOptions.find((option) => option.id === processId);

  function selectProcess(option: (typeof processOptions)[number]) {
    setProcessId(option.id);
    setProcessQuery(option.path);
    setListOpen(false);
  }

  /** 파트를 바꾸면 그 아래 선택들을 초기화한다. */
  function selectPart(id: string) {
    setPartId(id);
    setWorker("");
    setProcessId("");
    setProcessQuery("");
  }

  /** 고른 공정에 연결된 자동화 설비 */
  const linkedEquipment = data?.equipments.find(
    (equipment) => equipment.id === selectedProcess?.equipmentId,
  );

  // 이력 표를 날짜·담당자·공정으로 걸러본다. 비워두면(기본) 전체를 본다.
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyWorker, setHistoryWorker] = useState("");
  const [historyProcessId, setHistoryProcessId] = useState("");

  // 이력에 실제로 등장하는 담당자·공정만 필터 목록에 올린다.
  const historyWorkerOptions = useMemo(() => {
    if (!data) return [];
    const names = new Set(data.records.map((record) => record.worker).filter((name): name is string => !!name));
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [data]);

  const historyProcessOptions = useMemo(() => {
    if (!data) return [];
    const usedIds = new Set(data.records.map((record) => record.processId));
    return processOptions.filter((option) => usedIds.has(option.id));
  }, [data, processOptions]);

  const records = useMemo(() => {
    if (!data) return [];
    return [...data.records]
      .filter((record) => {
        if (historyFrom && record.date < historyFrom) return false;
        if (historyTo && record.date > historyTo) return false;
        if (historyWorker && record.worker !== historyWorker) return false;
        if (historyProcessId && record.processId !== historyProcessId) return false;
        return true;
      })
      .sort((a, b) =>
        a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date),
      );
  }, [data, historyFrom, historyTo, historyWorker, historyProcessId]);

  if (loading) return <p className="py-12 text-center text-sm text-ink-muted">불러오는 중…</p>;
  if (error || !data)
    return <p className="py-12 text-center text-sm text-critical">{error ?? "오류가 발생했습니다."}</p>;

  const editor = data.editor;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await reload();
      return true;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "처리하지 못했습니다.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!processId) {
      setMessage("목록에서 공정을 선택해주세요.");
      return;
    }
    const succeeded = await run(() =>
      apiSend("/api/records", "POST", {
        date,
        processId,
        startTime,
        endTime,
        quantity,
        worker: worker || null,
        assistType: assistType || null,
      }),
    );
    // 다음 입력을 위해 수량을 기본값으로 되돌린다. (파트·담당자·공정은 이어서 입력하기 편하게 유지)
    if (succeeded) setQuantity("25");
  }

  return (
    <div className="space-y-6">
      {!editor ? (
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-muted">
          지금은 조회만 가능합니다. 오른쪽 위 <strong>편집하기</strong>에서 비밀번호를 입력하면 실적을
          등록할 수 있습니다.
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-critical/40 bg-critical/5 px-4 py-3 text-sm text-critical">
          {message}
        </p>
      ) : null}

      {editor ? (
        <PartWorkerManager
          parts={parts}
          busy={busy}
          onSave={(id, workers) => run(() => apiSend(`/api/processes/${id}`, "PATCH", { workers }))}
        />
      ) : null}

      {editor ? (
        <Card
          title="생산실적 입력"
          description={`근무시간 ${WORK_START}~${WORK_END} 기준이며, 점심·휴식시간은 자동으로 빠집니다. 시간은 선택창으로도, 숫자 타이핑으로도 입력할 수 있습니다.`}
        >
          {parts.length === 0 ? (
            <p className="text-sm text-ink-muted">먼저 파트를 등록해주세요. (공정·표준ST 메뉴)</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {/* 파트를 가장 먼저 고른다 */}
              <div className="flex flex-wrap gap-1">
                {parts.map((part) => (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => selectPart(part.id)}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      part.id === selectedPartId
                        ? "bg-ink text-card font-medium"
                        : "border border-line text-ink-soft hover:text-ink"
                    }`}
                  >
                    {part.name}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* 담당자를 공정보다 먼저 고른다 */}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">담당자</span>
                  <select
                    value={worker}
                    onChange={(event) => {
                      setWorker(event.target.value);
                      setProcessId("");
                      setProcessQuery("");
                    }}
                    className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
                  >
                    <option value="">선택 안 함 (전체 공정 보기)</option>
                    {partWorkers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {partWorkers.length === 0 ? (
                    <span className="text-xs text-ink-muted">
                      이 파트에 등록된 담당자가 없습니다. 위 담당자 지정에서 추가해주세요.
                    </span>
                  ) : null}
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">
                    지원 구분{worker ? "" : " (담당자를 고르면 선택할 수 있어요)"}
                  </span>
                  <select
                    value={assistType}
                    onChange={(event) => setAssistType(event.target.value as typeof assistType)}
                    disabled={!worker}
                    className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink disabled:opacity-50"
                  >
                    <option value="">평소 실적 (본인)</option>
                    <option value="support">생산지원</option>
                    <option value="leave">연차대응</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">작업 일자</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
                  />
                </label>

                {/* 공정: 타이핑으로 검색해서 고른다 */}
                <div className="flex flex-col gap-1 lg:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted">
                      공정 (이름을 입력해 검색){worker ? " — 이 담당자의 공정만 보입니다" : ""}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                      <input
                        type="checkbox"
                        checked={showSubProcess}
                        onChange={(event) => {
                          setShowSubProcess(event.target.checked);
                          setListOpen(true);
                        }}
                      />
                      하위공정 별도입력
                    </label>
                  </div>

                  <div className="relative">
                    <input
                      value={processQuery}
                      onChange={(event) => {
                        setProcessQuery(event.target.value);
                        setProcessId("");
                        setListOpen(true);
                      }}
                      onFocus={() => setListOpen(true)}
                      placeholder="예: Assy5 (또는 클릭해서 목록 보기)"
                      className="w-full rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
                    />

                    {listOpen ? (
                      <>
                        {/* 목록 바깥을 누르면 닫히도록 */}
                        <button
                          type="button"
                          aria-label="목록 닫기"
                          onClick={() => setListOpen(false)}
                          className="fixed inset-0 z-10 cursor-default"
                        />
                        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-card py-1 shadow-lg">
                          {visibleOptions.length === 0 ? (
                            <li className="px-3 py-2 text-sm text-ink-muted">
                              해당하는 공정이 없습니다.
                              {worker
                                ? " (이 담당자에게 전담 공정이 지정돼 있는지 확인해주세요)"
                                : !showSubProcess
                                  ? " (하위공정 별도입력을 켜보세요)"
                                  : ""}
                            </li>
                          ) : (
                            visibleOptions.map((option) => (
                              <li key={option.id}>
                                <button
                                  type="button"
                                  onClick={() => selectProcess(option)}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-page ${
                                    option.id === processId ? "bg-page" : ""
                                  }`}
                                >
                                  <span className="text-ink">{option.path}</span>
                                  {option.equipmentId ? (
                                    <span className="text-xs text-ink-muted">⚙ 자동화</span>
                                  ) : null}
                                  {option.standardST === null ? (
                                    <span className="ml-auto text-xs text-ink-muted">
                                      표준ST 미등록
                                    </span>
                                  ) : (
                                    <span className="tabular ml-auto text-xs text-ink-muted">
                                      {option.standardST}초
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </>
                    ) : null}
                  </div>

                  {selectedProcess ? (
                    <span className="text-xs text-ink-muted">
                      선택됨: {selectedProcess.path} ({selectedProcess.level}단계)
                    </span>
                  ) : null}
                </div>

                <TimeField label="시작시간" value={startTime} onChange={setStartTime} />
                <TimeField label="종료시간" value={endTime} onChange={setEndTime} />

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">생산수량 (개)</span>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="예: 120"
                    className="tabular rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
                  />
                </label>

                {/* 자동화 설비는 공정에 연결된 것이 자동으로 적용된다 (따로 고르지 않는다) */}
                {linkedEquipment ? (
                  <p className="text-xs text-ink-muted lg:col-span-3">
                    ⚙ 자동화 공정입니다 — 이 실적은 <strong>{linkedEquipment.name}</strong> 의 효과금액에
                    자동으로 반영됩니다.
                  </p>
                ) : null}
              </div>

              {/* 실제 생산시간 미리보기 */}
              <div className="rounded-lg border border-line bg-page px-4 py-3 text-sm">
                {preview.error ? (
                  <p className="text-critical">{preview.error}</p>
                ) : preview.result ? (
                  <div className="space-y-1">
                    <p className="tabular text-ink">
                      실제 생산시간 <strong>{preview.result.productionMinutes}분</strong>
                      <span className="text-ink-muted">
                        {" "}
                        (전체 {preview.result.totalMinutes}분 − 휴게 {preview.result.breakMinutes}분)
                      </span>
                    </p>
                    {preview.result.appliedBreaks.length > 0 ? (
                      <p className="text-xs text-ink-muted">
                        제외된 시간:{" "}
                        {preview.result.appliedBreaks
                          .map((item) => `${item.name} ${item.minutes}분`)
                          .join(", ")}
                      </p>
                    ) : (
                      <p className="text-xs text-ink-muted">겹치는 휴게시간이 없습니다.</p>
                    )}
                    {quantity && Number(quantity) > 0 ? (
                      <p className="tabular text-xs text-ink-muted">
                        개당 실제ST ≈{" "}
                        {((preview.result.productionMinutes * 60) / Number(quantity)).toFixed(1)}초
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={busy || !!preview.error}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
              >
                실적 등록
              </button>
            </form>
          )}
        </Card>
      ) : null}

      <Card
        title="생산실적 이력"
        description={`총 ${records.length}건. 휴게시간: ${BREAK_TIMES.map((item) => `${item.start}~${item.end}`).join(", ")}`}
        action={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-ink-muted">날짜</label>
            <input
              type="date"
              value={historyFrom}
              onChange={(event) => setHistoryFrom(event.target.value)}
              className="rounded-md border border-line bg-card px-2 py-1 text-ink"
            />
            <span className="text-ink-muted">~</span>
            <input
              type="date"
              value={historyTo}
              onChange={(event) => setHistoryTo(event.target.value)}
              className="rounded-md border border-line bg-card px-2 py-1 text-ink"
            />

            <label className="ml-2 text-ink-muted">공정</label>
            <select
              value={historyProcessId}
              onChange={(event) => setHistoryProcessId(event.target.value)}
              className="rounded-md border border-line bg-card px-2 py-1 text-ink"
            >
              <option value="">전체</option>
              {historyProcessOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </select>

            <label className="text-ink-muted">담당자</label>
            <select
              value={historyWorker}
              onChange={(event) => setHistoryWorker(event.target.value)}
              className="rounded-md border border-line bg-card px-2 py-1 text-ink"
            >
              <option value="">전체</option>
              {historyWorkerOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            {historyFrom || historyTo || historyWorker || historyProcessId ? (
              <button
                type="button"
                onClick={() => {
                  setHistoryFrom("");
                  setHistoryTo("");
                  setHistoryWorker("");
                  setHistoryProcessId("");
                }}
                className="rounded-md border border-line px-2 py-1 text-ink-soft"
              >
                전체 초기화
              </button>
            ) : null}
          </div>
        }
      >
        {records.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">등록된 실적이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="pb-2 font-medium">일자</th>
                  <th className="pb-2 font-medium">공정</th>
                  <th className="pb-2 font-medium">시간</th>
                  <th className="pb-2 text-right font-medium">생산시간</th>
                  <th className="pb-2 text-right font-medium">수량{editor ? " (수정 가능)" : ""}</th>
                  <th className="pb-2 text-right font-medium">개당 실제ST</th>
                  <th className="pb-2 font-medium">담당자</th>
                  <th className="pb-2 font-medium">설비</th>
                  <th className="pb-2 text-right font-medium">회수액</th>
                  {editor ? <th className="pb-2" /> : null}
                </tr>
              </thead>
              <tbody className="tabular">
                {records.map((record) => {
                  // 회수액(효과금액)은 저장된 값이 아니라 항상 지금 계산식으로 다시 계산해서 보여준다.
                  const effect = calcRecordRecovery(
                    data as Database,
                    record.processId,
                    record.quantity,
                    record.productionMinutes,
                  );
                  return (
                    <RecordRow
                      key={record.id}
                      record={record}
                      processOptions={processOptions}
                      partWorkerOptions={partWorkers}
                      equipmentName={
                        data.equipments.find((item) => item.id === effect.equipmentId)?.name ?? null
                      }
                      effectAmount={effect.recoveredAmount}
                      effectNote={effect.recoveredNote}
                      editor={editor}
                      busy={busy}
                      onSave={(patch) => run(() => apiSend(`/api/records/${record.id}`, "PATCH", patch))}
                      onDelete={() => run(() => apiSend(`/api/records/${record.id}`, "DELETE"))}
                    />
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

type PartOption = { id: string; name: string; workers?: string };

/**
 * 담당자 지정 — 파트(1단계)마다 담당자 이름을 콤마로 구분해 한 번에 관리한다.
 * (파트가 몇 개 안 되니 표 하나로 충분하다는 전제로, 개별 담당자 추가/삭제 화면 없이 이렇게 관리한다)
 */
function PartWorkerManager({
  parts,
  busy,
  onSave,
}: {
  parts: PartOption[];
  busy: boolean;
  onSave: (partId: string, workers: string) => Promise<boolean>;
}) {
  const [opened, setOpened] = useState(true);

  return (
    <Card
      title="담당자 지정"
      description="파트마다 담당자 이름을 콤마로 구분해서 한 번에 적어두면, 생산실적 입력할 때 그 목록에서 고를 수 있습니다."
      action={
        <button
          type="button"
          onClick={() => setOpened((prev) => !prev)}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:text-ink"
        >
          {opened ? "접기" : "펼치기"}
        </button>
      }
    >
      {opened ? (
        parts.length === 0 ? (
          <p className="text-sm text-ink-muted">등록된 파트가 없습니다. (공정·표준ST 메뉴에서 추가)</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="pb-2 font-medium">파트</th>
                <th className="pb-2 font-medium">담당자 (콤마로 구분)</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <PartWorkerRow key={part.id} part={part} busy={busy} onSave={onSave} />
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </Card>
  );
}

function PartWorkerRow({
  part,
  busy,
  onSave,
}: {
  part: PartOption;
  busy: boolean;
  onSave: (partId: string, workers: string) => Promise<boolean>;
}) {
  const saved = part.workers ?? "";
  const [text, setText] = useState(saved);
  const changed = text !== saved;

  return (
    <tr className="border-b border-line/60">
      <td className="py-2 pr-3 align-top text-ink">{part.name}</td>
      <td className="py-2 pr-3">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="예: 김철수, 이영희, 박민수"
          className="w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
        />
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          disabled={busy || !changed}
          onClick={() => onSave(part.id, joinWorkerNames(text.split(",")))}
          className="rounded-md bg-ink px-3 py-1.5 text-sm text-card disabled:opacity-40"
        >
          저장
        </button>
      </td>
    </tr>
  );
}

type ProcessOption = {
  id: string;
  path: string;
  standardST: number | null;
  level: number;
  equipmentId: string | null;
  worker: string | null;
  topId: string;
};

/** 수정 저장 시 서버로 보낼 수 있는 필드들 */
type RecordPatch = {
  date?: string;
  processId?: string;
  startTime?: string;
  endTime?: string;
  quantity?: string;
  worker?: string | null;
  assistType?: AssistType;
};

type RecordRowProps = {
  record: ProductionRecord;
  processOptions: ProcessOption[];
  partWorkerOptions: string[];
  equipmentName: string | null;
  /** 저장된 값이 아니라 지금 계산식으로 다시 계산한 효과금액 */
  effectAmount: number | null;
  effectNote: string | null;
  editor: boolean;
  busy: boolean;
  onSave: (patch: RecordPatch) => void;
  onDelete: () => void;
};

/**
 * 생산실적 이력 한 줄.
 * 편집 모드에서 "수정"을 누르면 일자·공정·시간·수량·담당자·지원구분을 전부 고쳐서 저장할 수 있다.
 */
function RecordRow({
  record,
  processOptions,
  partWorkerOptions,
  equipmentName,
  effectAmount,
  effectNote,
  editor,
  busy,
  onSave,
  onDelete,
}: RecordRowProps) {
  const [editing, setEditing] = useState(false);

  const [draftDate, setDraftDate] = useState(record.date);
  const [draftProcessId, setDraftProcessId] = useState(record.processId);
  const [draftStart, setDraftStart] = useState(record.startTime);
  const [draftEnd, setDraftEnd] = useState(record.endTime);
  const [draftQuantity, setDraftQuantity] = useState(String(record.quantity));
  const [draftWorker, setDraftWorker] = useState(record.worker ?? "");
  const [draftAssistType, setDraftAssistType] = useState<"" | "support" | "leave">(
    record.assistType ?? "",
  );

  const processPath =
    processOptions.find((option) => option.id === record.processId)?.path ?? "(삭제된 공정)";

  // 이 실적의 담당자를 select 옵션에 없더라도 보여줄 수 있게 합친다. (파트 담당자 목록이 바뀐 경우)
  const workerChoices = record.worker && !partWorkerOptions.includes(record.worker)
    ? [...partWorkerOptions, record.worker]
    : partWorkerOptions;

  // 수정 중인 시간으로 생산시간을 미리 계산해 보여준다.
  const draftPreview = (() => {
    try {
      return calcProductionMinutes(draftStart, draftEnd);
    } catch {
      return null;
    }
  })();

  function startEdit() {
    setDraftDate(record.date);
    setDraftProcessId(record.processId);
    setDraftStart(record.startTime);
    setDraftEnd(record.endTime);
    setDraftQuantity(String(record.quantity));
    setDraftWorker(record.worker ?? "");
    setDraftAssistType(record.assistType ?? "");
    setEditing(true);
  }

  function handleSave() {
    onSave({
      date: draftDate,
      processId: draftProcessId,
      startTime: draftStart,
      endTime: draftEnd,
      quantity: draftQuantity,
      worker: draftWorker || null,
      assistType: draftAssistType || null,
    });
    setEditing(false);
  }

  if (editor && editing) {
    return (
      <tr className="border-b border-line/60 bg-page/60">
        <td className="py-2 pr-3">
          <input
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
            className="rounded-md border border-line bg-card px-2 py-1 text-ink"
          />
        </td>
        <td className="py-2 pr-3">
          <select
            value={draftProcessId}
            onChange={(event) => setDraftProcessId(event.target.value)}
            className="min-w-40 rounded-md border border-line bg-card px-2 py-1 text-ink"
          >
            {processOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.path}
              </option>
            ))}
          </select>
        </td>
        <td className="py-2 pr-3">
          <div className="flex flex-col gap-1">
            <TimeField label="시작" value={draftStart} onChange={setDraftStart} />
            <TimeField label="종료" value={draftEnd} onChange={setDraftEnd} />
          </div>
        </td>
        <td className="py-2 text-right text-ink-muted">
          {draftPreview ? `${formatNumber(draftPreview.productionMinutes)}분` : "-"}
        </td>
        <td className="py-2 pr-4 text-right">
          <input
            type="number"
            min={1}
            value={draftQuantity}
            onChange={(event) => setDraftQuantity(event.target.value)}
            className="tabular w-20 rounded-md border border-line bg-card px-2 py-1 text-right text-ink"
          />
        </td>
        <td className="py-2 pr-4 text-right text-ink-muted">
          {draftPreview && Number(draftQuantity) > 0
            ? `${((draftPreview.productionMinutes * 60) / Number(draftQuantity)).toFixed(1)}초`
            : "-"}
        </td>
        <td className="py-2 pr-3">
          <div className="flex flex-col gap-1">
            <select
              value={draftWorker}
              onChange={(event) => setDraftWorker(event.target.value)}
              className="min-w-24 rounded-md border border-line bg-card px-2 py-1 text-ink"
            >
              <option value="">선택 안 함</option>
              {workerChoices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={draftAssistType}
              onChange={(event) => setDraftAssistType(event.target.value as typeof draftAssistType)}
              className="min-w-24 rounded-md border border-line bg-card px-2 py-1 text-xs text-ink"
            >
              <option value="">평소 실적</option>
              <option value="support">생산지원</option>
              <option value="leave">연차대응</option>
            </select>
          </div>
        </td>
        <td className="py-2 pr-3 text-ink-muted">공정에 따라 자동 결정</td>
        <td className="py-2 text-right text-ink-muted">저장하면 다시 계산됨</td>
        <td className="py-2 pl-3 text-right whitespace-nowrap">
          <button
            type="button"
            disabled={busy}
            onClick={handleSave}
            className="rounded-md bg-ink px-2 py-1 text-xs text-card disabled:opacity-40"
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="ml-1 rounded-md border border-line px-2 py-1 text-xs text-ink-soft"
          >
            취소
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-line/60">
      <td className="py-2 pr-3 text-ink-soft">{record.date}</td>
      <td className="py-2 pr-3 text-ink">{processPath}</td>
      <td className="py-2 pr-3 text-ink-muted">
        {record.startTime}~{record.endTime}
        {record.shift === "night" ? (
          <span className="ml-1 rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">야간</span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right text-ink-soft">{formatNumber(record.productionMinutes)}분</td>
      <td className="py-2 pr-4 text-right text-ink-soft">{formatNumber(record.quantity)}개</td>
      <td className="py-2 pr-4 text-right text-ink">
        {record.quantity > 0
          ? `${((record.productionMinutes * 60) / record.quantity).toFixed(1)}초`
          : "-"}
      </td>
      <td className="py-2 pr-3 text-ink-soft">
        {record.worker ?? "-"}
        {record.assistType ? (
          <span className="ml-1 rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">
            {ASSIST_LABEL[record.assistType]}
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-ink-soft">{equipmentName ?? "-"}</td>
      <td className="py-2 text-right">
        {effectAmount === null ? (
          <span className="text-ink-muted" title={effectNote ?? undefined}>
            {equipmentName ? "미계산" : "-"}
          </span>
        ) : (
          <span className="text-ink">{formatMoney(effectAmount)}</span>
        )}
      </td>
      {editor ? (
        <td className="py-2 pl-3 text-right whitespace-nowrap">
          <button
            type="button"
            disabled={busy}
            onClick={startEdit}
            className="rounded-md border border-line px-2 py-1 text-xs text-ink-soft disabled:opacity-40"
          >
            수정
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="ml-1 rounded-md border border-line px-2 py-1 text-xs text-ink-soft disabled:opacity-40"
          >
            삭제
          </button>
        </td>
      ) : null}
    </tr>
  );
}
