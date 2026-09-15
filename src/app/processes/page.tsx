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
import { parseWorkerNames } from "@/lib/stats";
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
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 파트(1단계) 필터 — 파트를 고르면 그 파트 아래(2단계부터)만 보여준다. 비워두면 전체를 본다.
  const [partFilter, setPartFilter] = useState("");

  const tree = useMemo(() => (data ? buildTree(data.processes) : []), [data]);
  const parts = tree; // 최상위 = 파트

  const rows = useMemo(() => {
    if (!partFilter) return flattenTree(tree);
    const selected = tree.find((part) => part.id === partFilter);
    return selected ? flattenTree([selected]) : [];
  }, [tree, partFilter]);

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

  async function addProcess(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await apiSend("/api/processes", "POST", {
        name: newName,
        parentId: newParentId || null,
      });
      setNewName("");
    });
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

      {editor ? (
        <Card
          title="파트·공정 추가"
          description="상위를 비워두면 1단계(파트)로, 파트를 고르면 그 아래 공정으로 만들어집니다."
        >
          <form onSubmit={addProcess} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">상위 공정</label>
              <select
                value={newParentId}
                onChange={(event) => setNewParentId(event.target.value)}
                className="min-w-56 rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
              >
                <option value="">(최상위 · 파트로 만들기)</option>
                {flattenTree(tree)
                  .filter((row) => row.level < MAX_LEVEL)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {"— ".repeat(row.level - 1)}
                      {row.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">공정 이름</label>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="예: 조립 1공정"
                className="min-w-56 rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
            >
              추가
            </button>
          </form>
        </Card>
      ) : null}

      <Card
        title="파트·공정 목록"
        description={`1단계는 파트, 그 아래가 공정입니다(최대 ${MAX_LEVEL}단계). 이름과 표준ST는 언제든 고쳐서 저장할 수 있습니다. 표준ST는 "1개 생산에 필요한 시간(초)"입니다. 파트에는 담당자 목록(콤마로 구분)을, 2단계 공정에는 전담 담당자를 지정할 수 있습니다.`}
        action={
          parts.length > 0 ? (
            <div className="flex flex-wrap gap-1">
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
            </div>
          ) : null
        }
      >
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
                  equipments={data.equipments}
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

/** 저장할 때 서버로 보낼 값들 (단계에 따라 workers 또는 worker만 채워 보낸다) */
type ProcessPatch = {
  name: string;
  standardST: string;
  equipmentId: string;
  dailyTarget?: string;
  workers?: string;
  worker?: string;
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
function levelLabel(level: number): string {
  return level === 1 ? "파트" : `${level}단계 공정`;
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
  const savedWorkersText = node.workers ?? "";
  const savedWorker = node.worker ?? "";

  const [name, setName] = useState(savedName);
  const [standardST, setStandardST] = useState(savedST);
  const [equipmentId, setEquipmentId] = useState(savedEquipmentId);
  const [dailyTarget, setDailyTarget] = useState(savedDailyTarget);
  const [workersText, setWorkersText] = useState(savedWorkersText);
  const [worker, setWorker] = useState(savedWorker);
  const [addOpen, setAddOpen] = useState(false);
  const [childName, setChildName] = useState("");

  const isPart = node.level === 1;

  const changed =
    name !== savedName ||
    standardST !== savedST ||
    equipmentId !== savedEquipmentId ||
    (isPart ? workersText !== savedWorkersText : dailyTarget !== savedDailyTarget || worker !== savedWorker);

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
      ...(isPart ? { workers: workersText } : { dailyTarget, worker }),
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

        <div className="ml-auto flex items-center gap-2">
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

              {isPart ? (
                <>
                  {/* 파트: 담당자 이름을 콤마로 구분해 한 번에 관리한다 */}
                  <input
                    value={workersText}
                    onChange={(event) => setWorkersText(event.target.value)}
                    placeholder="담당자 (콤마로 구분: 김철수, 이영희)"
                    className="min-w-56 rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink"
                  />
                </>
              ) : (
                <>
                  {/* 일일 목표수량은 2단계 공정에만 설정한다 (대시보드 달성 현황에서 쓴다) */}
                  {node.level === 2 ? (
                    <>
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

                      {/* 전담 담당자는 소속 파트의 담당자 목록 중에서 고른다 */}
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
                </>
              )}

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
