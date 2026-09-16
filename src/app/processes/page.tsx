"use client";

/**
 * 파트·공정·표준ST 관리
 * 1단계는 파트이고, 그 아래로 최대 5단계까지 만들 수 있다.
 * 표준ST는 하위 단계에 입력하면 상위는 그 합산으로 본다. 상위에 직접 값을 넣으면 합산과 다른지 알려준다.
 *
 * 담당자 관리 방식:
 * - 1단계(파트)에는 그 파트에 소속된 담당자 이름들을 콤마로 구분해 텍스트 하나로 관리한다.
 * - 2단계 공정에는 그 파트 담당자 중 이 공정을 전담하는 한 명을 지정한다.
 */

import { useMemo, useState } from "react";
import Card from "@/components/Card";
import { apiSend, useAppData } from "@/lib/client";
import { buildColorMap, colorFrom } from "@/lib/colors";
import { joinWorkerNames, parseWorkerNames, sortByProcessOrder } from "@/lib/stats";
import type { Equipment, Process } from "@/lib/types";

const MAX_LEVEL = 5;

type TreeNode = Process & { level: number; children: TreeNode[] };

/**
 * 이 공정의 표준ST를 구한다.
 * 직접 입력한 값이 있으면 그 값을, 없으면 하위 공정들의 합산을 쓴다.
 */
function effectiveST(node: TreeNode): number | null {
  if (node.standardST !== null) return node.standardST;
  return sumChildST(node);
}

/** 하위 공정들의 표준ST 합계. 하위가 없거나 값이 하나도 없으면 null */
function sumChildST(node: TreeNode): number | null {
  if (node.children.length === 0) return null;

  let sum = 0;
  let found = false;
  for (const child of node.children) {
    const value = effectiveST(child);
    if (value !== null) {
      sum += value;
      found = true;
    }
  }
  return found ? sum : null;
}

/** 평평한 공정 목록을 계층 구조로 바꾼다. */
function buildTree(processes: Process[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(
    processes.map((process) => [process.id, { ...process, level: 1, children: [] }]),
  );
  const roots: TreeNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  // 형제 공정은 순서(order)를 설정해뒀으면 그 순서대로, 아니면 원래 순서 그대로 보여준다.
  for (const node of nodes.values()) {
    node.children = sortByProcessOrder(node.children);
  }

  // 단계(level)를 채워 넣는다.
  const assignLevel = (node: TreeNode, level: number) => {
    node.level = level;
    node.children.forEach((child) => assignLevel(child, level + 1));
  };
  roots.forEach((root) => assignLevel(root, 1));

  return roots;
}

/** 트리를 화면에 그릴 순서대로 평평하게 편다. */
function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

export default function ProcessesPage() {
  const { data, loading, error, reload } = useAppData();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 팀 탭 — 팀마다 파트·공정을 따로 관리한다. (기존 조립/검사/포장은 생산2팀 소속)
  const [selectedTeam, setSelectedTeam] = useState<string>("team2");

  // 팀 추가 — 팀 탭 줄의 + 버튼으로 새 생산팀을 만든다.
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  // 파트 추가 — "파트·공정 지정" 목록 위 필터 버튼 줄의 + 버튼으로 새 파트(1단계)를 만든다.
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [newPartName, setNewPartName] = useState("");

  // 파트(1단계) 필터 — 파트를 고르면 그 파트 아래(2단계부터)만 보여준다. 비워두면 전체를 본다.
  const [partFilter, setPartFilter] = useState("");

  const tree = useMemo(() => (data ? buildTree(data.processes) : []), [data]);
  // 최상위 = 파트. 선택한 팀 소속 파트만 본다. (팀 정보가 없는 옛 데이터는 생산2팀으로 본다)
  const parts = useMemo(
    () => tree.filter((part) => (part.team ?? "team2") === selectedTeam),
    [tree, selectedTeam],
  );

  const rows = useMemo(() => {
    if (!partFilter) return flattenTree(parts);
    const selected = parts.find((part) => part.id === partFilter);
    return selected ? flattenTree([selected]) : [];
  }, [parts, partFilter]);

  // 자동화 설비도 팀별로 따로 관리한다.
  const teamEquipments = useMemo(
    () => (data ? data.equipments.filter((equipment) => equipment.team === selectedTeam) : []),
    [data, selectedTeam],
  );

  const colorMap = useMemo(
    () => buildColorMap((data?.processes ?? []).map((process) => process.id)),
    [data],
  );

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

  /** 새 파트(1단계)를 추가한다. (현재 선택된 팀 소속으로 만든다) */
  async function addPart(event: React.FormEvent) {
    event.preventDefault();
    const succeeded = await run(() =>
      apiSend("/api/processes", "POST", { name: newPartName, parentId: null, team: selectedTeam }),
    );
    if (succeeded) {
      setNewPartName("");
      setAddPartOpen(false);
    }
  }

  /** 팀 탭을 바꾸면 그 팀 기준으로 필터·추가 폼을 초기화한다. */
  function selectTeam(team: string) {
    setSelectedTeam(team);
    setPartFilter("");
    setAddPartOpen(false);
  }

  /** 새 생산팀을 추가한다. 팀은 개수 제한 없이 늘어날 수 있다. */
  async function addTeam(event: React.FormEvent) {
    event.preventDefault();
    const succeeded = await run(() => apiSend("/api/teams", "POST", { name: newTeamName }));
    if (succeeded) {
      setNewTeamName("");
      setAddTeamOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      {!editor ? (
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-muted">
          지금은 조회만 가능합니다. 오른쪽 위 <strong>편집하기</strong>에서 비밀번호를 입력하면 공정을
          추가하거나 표준ST를 수정할 수 있습니다.
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-critical/40 bg-critical/5 px-4 py-3 text-sm text-critical">
          {message}
        </p>
      ) : null}

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
        {editor ? (
          <button
            type="button"
            onClick={() => setAddTeamOpen((prev) => !prev)}
            title="팀 추가"
            aria-label="팀 추가"
            className="h-7 w-7 shrink-0 rounded-md border border-line text-sm leading-none text-ink-soft hover:text-ink"
          >
            +
          </button>
        ) : null}
      </div>

      {editor && addTeamOpen ? (
        <form onSubmit={addTeam} className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.target.value)}
            placeholder="새 팀 이름 (예: 생산4팀)"
            className="min-w-48 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-ink px-3 py-1.5 text-sm text-card disabled:opacity-40"
          >
            추가
          </button>
          <button
            type="button"
            onClick={() => {
              setAddTeamOpen(false);
              setNewTeamName("");
            }}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft"
          >
            취소
          </button>
        </form>
      ) : null}

      {editor ? (
        <PartWorkerManager
          parts={parts}
          busy={busy}
          onSave={(partId, workers) => run(() => apiSend(`/api/processes/${partId}`, "PATCH", { workers }))}
        />
      ) : null}

      <Card
        title="파트·공정 지정"
        action={
          <div className="flex flex-wrap gap-1">
            {parts.length > 0 ? (
              <button
                type="button"
                onClick={() => setPartFilter("")}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  partFilter === ""
                    ? "bg-ink text-card font-medium"
                    : "border border-line text-ink-soft hover:text-ink"
                }`}
              >
                전체
              </button>
            ) : null}
            {parts.map((part) => (
              <button
                key={part.id}
                type="button"
                onClick={() => setPartFilter(part.id)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  partFilter === part.id
                    ? "bg-ink text-card font-medium"
                    : "border border-line text-ink-soft hover:text-ink"
                }`}
              >
                {part.name}
              </button>
            ))}
            {editor ? (
              <button
                type="button"
                onClick={() => setAddPartOpen((prev) => !prev)}
                title="파트 추가"
                aria-label="파트 추가"
                className="h-7 w-7 shrink-0 rounded-md border border-line text-sm leading-none text-ink-soft hover:text-ink"
              >
                +
              </button>
            ) : null}
          </div>
        }
      >
        {editor && addPartOpen ? (
          <form onSubmit={addPart} className="mb-4 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={newPartName}
              onChange={(event) => setNewPartName(event.target.value)}
              placeholder="새 파트 이름"
              className="min-w-48 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-ink px-3 py-1.5 text-sm text-card disabled:opacity-40"
            >
              추가
            </button>
            <button
              type="button"
              onClick={() => {
                setAddPartOpen(false);
                setNewPartName("");
              }}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft"
            >
              취소
            </button>
          </form>
        ) : null}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">등록된 공정이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              // 이 노드가 속한 파트(최상위)의 담당자 목록을 구한다. (2단계 전담 담당자 선택지로 쓴다)
              const topId = row.level === 1 ? row.id : (findAncestorPartId(row, data.processes) ?? row.id);
              const topNode = data.processes.find((process) => process.id === topId);
              const partWorkers = parseWorkerNames(topNode?.workers);

              return (
                <ProcessRow
                  key={row.id}
                  node={row}
                  editor={editor}
                  busy={busy}
                  color={colorFrom(colorMap, row.id)}
                  childSum={sumChildST(row)}
                  canAddChild={row.level < MAX_LEVEL}
                  equipments={teamEquipments}
                  partWorkers={partWorkers}
                  onSave={(patch) => run(() => apiSend(`/api/processes/${row.id}`, "PATCH", patch))}
                  onAddChild={(name) =>
                    run(() => apiSend("/api/processes", "POST", { name, parentId: row.id }))
                  }
                  onDelete={() => run(() => apiSend(`/api/processes/${row.id}`, "DELETE"))}
                />
              );
            })}
          </ul>
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
          <p className="text-sm text-ink-muted">등록된 파트가 없습니다. (위 + 버튼으로 추가)</p>
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

/** 이 노드의 최상위(파트) id를 찾는다. */
function findAncestorPartId(node: TreeNode, allProcesses: Process[]): string | null {
  const map = new Map(allProcesses.map((process) => [process.id, process]));
  let current: Process | undefined = map.get(node.id);
  let guard = 0;
  while (current?.parentId && guard < 10) {
    current = map.get(current.parentId);
    guard += 1;
  }
  return current?.id ?? null;
}

/** 저장할 때 서버로 보낼 값들 (2단계 공정에만 dailyTarget/worker를 채워 보낸다) */
type ProcessPatch = {
  name: string;
  standardST: string;
  equipmentId: string;
  dailyTarget?: string;
  worker?: string;
  order?: string;
};

type RowProps = {
  node: TreeNode;
  editor: boolean;
  busy: boolean;
  color: string;
  /** 하위 공정들의 표준ST 합계 (하위가 없으면 null) */
  childSum: number | null;
  /** 이 단계 아래로 더 만들 수 있는지 */
  canAddChild: boolean;
  /** 연결할 수 있는 자동화 설비 목록 */
  equipments: Equipment[];
  /** 이 노드가 속한 파트의 담당자 이름 목록 (2단계 전담 담당자 선택지) */
  partWorkers: string[];
  onSave: (patch: ProcessPatch) => void;
  onAddChild: (name: string) => Promise<boolean>;
  onDelete: () => void;
};

/** 단계별 이름표 (1단계 = 파트, 그 아래는 공정) */
const LEVEL_LABELS: Record<number, string> = {
  1: "파트",
  2: "Assy",
  3: "단위공정1단계",
  4: "단위공정2단계",
  5: "단위공정3단계",
};

function levelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? `${level}단계 공정`;
}

function ProcessRow({
  node,
  editor,
  busy,
  color,
  childSum,
  canAddChild,
  equipments,
  partWorkers,
  onSave,
  onAddChild,
  onDelete,
}: RowProps) {
  const savedName = node.name;
  const savedST = node.standardST === null ? "" : String(node.standardST);
  const savedEquipmentId = node.equipmentId ?? "";
  const savedDailyTarget = node.dailyTarget == null ? "" : String(node.dailyTarget);
  const savedWorker = node.worker ?? "";
  const savedOrder = node.order == null ? "" : String(node.order);

  const [name, setName] = useState(savedName);
  const [standardST, setStandardST] = useState(savedST);
  const [equipmentId, setEquipmentId] = useState(savedEquipmentId);
  const [dailyTarget, setDailyTarget] = useState(savedDailyTarget);
  const [worker, setWorker] = useState(savedWorker);
  const [order, setOrder] = useState(savedOrder);
  const [addOpen, setAddOpen] = useState(false);
  const [childName, setChildName] = useState("");

  const isPart = node.level === 1;
  const isSecondLevel = !isPart && node.level === 2;

  const changed =
    name !== savedName ||
    standardST !== savedST ||
    equipmentId !== savedEquipmentId ||
    (!isPart && (dailyTarget !== savedDailyTarget || worker !== savedWorker)) ||
    (isSecondLevel && order !== savedOrder);

  const linkedEquipment = equipments.find((item) => item.id === node.equipmentId);

  // 직접 넣은 값이 하위 합산과 다른지 확인한다.
  const entered = standardST.trim() === "" ? null : Number(standardST);
  const mismatched =
    childSum !== null &&
    entered !== null &&
    Number.isFinite(entered) &&
    Math.abs(entered - childSum) > 0.001;

  /** 저장 전에, 하위 합산과 다른 값이면 한 번 더 물어본다. */
  function handleSave() {
    if (mismatched && entered !== null) {
      const confirmed = window.confirm(
        `하위 공정 표준ST 합산은 ${childSum!.toFixed(1)}초입니다.\n` +
          `입력하신 값은 ${entered}초로, 합산과 다릅니다.\n\n` +
          `그대로 저장할까요?`,
      );
      if (!confirmed) return;
    }
    onSave({
      name,
      standardST,
      equipmentId,
      ...(isPart ? {} : { dailyTarget, worker }),
      ...(isSecondLevel ? { order } : {}),
    });
  }

  async function handleAddChild(event: React.FormEvent) {
    event.preventDefault();
    const succeeded = await onAddChild(childName);
    if (succeeded) {
      setChildName("");
      setAddOpen(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-sm"
          style={{ marginLeft: (node.level - 1) * 20, backgroundColor: color }}
        />

        {editor ? (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="이름"
            className="min-w-44 flex-1 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
          />
        ) : (
          <span className="text-sm text-ink">{node.name}</span>
        )}

        <span className="rounded bg-page px-1.5 py-0.5 text-xs text-ink-muted">
          {levelLabel(node.level)}
        </span>

        {/* 이 단계 아래에 바로 공정을 추가하는 버튼 */}
        {editor && canAddChild ? (
          <button
            type="button"
            onClick={() => setAddOpen((prev) => !prev)}
            title={`${node.name} 아래에 공정 추가`}
            aria-label={`${node.name} 아래에 공정 추가`}
            className="h-7 w-7 shrink-0 rounded-md border border-line text-sm leading-none text-ink-soft hover:text-ink"
          >
            +
          </button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editor ? (
            <>
              {/* 자동화 공정이면 설비를 연결해둔다 (실적 입력 시 자동 선택된다) */}
              {equipments.length > 0 ? (
                <select
                  value={equipmentId}
                  onChange={(event) => setEquipmentId(event.target.value)}
                  title="자동화 설비 연결"
                  className="max-w-40 rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink"
                >
                  <option value="">자동화 아님</option>
                  {equipments.map((equipment) => (
                    <option key={equipment.id} value={equipment.id}>
                      ⚙ {equipment.name}
                    </option>
                  ))}
                </select>
              ) : null}

              {/* 하위 합산이 있으면 함께 보여준다 */}
              {childSum !== null ? (
                <span
                  className="tabular rounded bg-page px-1.5 py-0.5 text-xs"
                  style={{ color: mismatched ? "var(--status-warning)" : "var(--text-muted)" }}
                >
                  하위 합산 {childSum.toFixed(1)}초{mismatched ? " · 입력값과 다름" : ""}
                </span>
              ) : null}

              <input
                type="number"
                min={0}
                step="0.1"
                value={standardST}
                onChange={(event) => setStandardST(event.target.value)}
                placeholder={childSum !== null ? childSum.toFixed(1) : "표준ST"}
                className="tabular w-28 rounded-md border border-line bg-card px-2 py-1.5 text-right text-sm text-ink"
              />
              <span className="text-xs text-ink-muted">초/개</span>

              {/* 일일 목표수량과 전담 담당자는 2단계 공정에만 설정한다 (대시보드 달성 현황에서 쓴다) */}
              {isSecondLevel ? (
                <>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={order}
                    onChange={(event) => setOrder(event.target.value)}
                    placeholder="순서"
                    title="공정 목록·야마즈미 차트 표시 순서 (작을수록 앞)"
                    className="tabular w-16 rounded-md border border-line bg-card px-2 py-1.5 text-right text-sm text-ink"
                  />

                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={dailyTarget}
                    onChange={(event) => setDailyTarget(event.target.value)}
                    placeholder="목표수량"
                    title="일일 목표수량 (개)"
                    className="tabular w-24 rounded-md border border-line bg-card px-2 py-1.5 text-right text-sm text-ink"
                  />
                  <span className="text-xs text-ink-muted">개/일</span>

                  {/* 전담 담당자는 소속 파트의 담당자 목록 중에서 고른다 (위 "담당자 지정" 표에서 관리) */}
                  <select
                    value={worker}
                    onChange={(event) => setWorker(event.target.value)}
                    title="전담 담당자"
                    className="max-w-32 rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink"
                  >
                    <option value="">담당자 미지정</option>
                    {partWorkers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    {/* 이미 지정돼 있던 이름이 파트 목록에서 빠졌으면(이름 수정 등) 그래도 보여준다 */}
                    {worker && !partWorkers.includes(worker) ? (
                      <option value={worker}>{worker} (파트 목록에 없음)</option>
                    ) : null}
                  </select>
                </>
              ) : null}

              <button
                type="button"
                disabled={busy || !changed}
                onClick={handleSave}
                className="rounded-md bg-ink px-3 py-1.5 text-sm text-card disabled:opacity-40"
              >
                저장
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft disabled:opacity-40"
              >
                삭제
              </button>
            </>
          ) : (
            <span className="tabular flex items-center gap-2 text-sm text-ink-soft">
              {linkedEquipment ? (
                <span className="rounded bg-page px-1.5 py-0.5 text-xs text-ink-muted">
                  ⚙ {linkedEquipment.name}
                </span>
              ) : null}
              {effectiveST(node) === null ? (
                <span className="text-ink-muted">표준ST 미등록</span>
              ) : (
                <>
                  {effectiveST(node)!.toFixed(1)}초/개
                  {node.standardST === null && childSum !== null ? (
                    <span className="ml-1 text-xs text-ink-muted">(하위 합산)</span>
                  ) : null}
                  {mismatched ? (
                    <span className="ml-1 text-xs" style={{ color: "var(--status-warning)" }}>
                      (하위 합산 {childSum!.toFixed(1)}초와 다름)
                    </span>
                  ) : null}
                </>
              )}
              {node.level === 2 && node.order != null ? (
                <span className="text-xs text-ink-muted">· 순서 {node.order}</span>
              ) : null}
              {node.level === 2 && node.dailyTarget != null ? (
                <span className="text-xs text-ink-muted">· 목표 {node.dailyTarget}개/일</span>
              ) : null}
              {isPart && node.workers ? (
                <span className="rounded bg-page px-1.5 py-0.5 text-xs text-ink-muted">
                  담당자 {node.workers}
                </span>
              ) : null}
              {!isPart && node.worker ? (
                <span className="rounded bg-page px-1.5 py-0.5 text-xs text-ink-muted">
                  담당 {node.worker}
                </span>
              ) : null}
            </span>
          )}
        </div>
      </div>

      {/* + 를 누르면 이 공정 바로 아래에 새 공정을 만든다 */}
      {editor && addOpen ? (
        <form
          onSubmit={handleAddChild}
          className="mt-3 flex flex-wrap items-center gap-2"
          style={{ marginLeft: node.level * 20 }}
        >
          <span className="text-xs text-ink-muted">
            ↳ {node.name} 아래 {levelLabel(node.level + 1)} 추가
          </span>
          <input
            autoFocus
            value={childName}
            onChange={(event) => setChildName(event.target.value)}
            placeholder="새 공정 이름"
            className="min-w-48 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-ink px-3 py-1.5 text-sm text-card disabled:opacity-40"
          >
            추가
          </button>
          <button
            type="button"
            onClick={() => {
              setAddOpen(false);
              setChildName("");
            }}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft"
          >
            취소
          </button>
        </form>
      ) : null}
    </li>
  );
}
