"use client";

/**
 * 자동화 설비 관리
 * 설비마다 투자비용 / 시작 시점 누적 회수액 / 회수액 계산식을 직접 설정한다.
 */

import { useMemo, useState } from "react";
import Card from "@/components/Card";
import DateField from "@/components/DateField";
import { apiSend, useAppData } from "@/lib/client";
import { extractVariables } from "@/lib/formula";
import { BUILT_IN_VARIABLES } from "@/lib/roi";
import { formatMoney } from "@/lib/stats";
import type { Equipment, FormulaVariable } from "@/lib/types";

/** 새 설비를 만들 때 쓰는 기본값 (사용자가 화면에서 바로 고칠 수 있다) */
function defaultForm(team: string) {
  return {
    name: "",
    team,
    investmentCost: "",
    initialRecovered: "0",
    initialRecoveredUntil: "",
    // 효과금액 = 생산수량 × 임률 × 세이브시간(분)
    formula: "수량 * 임률 * 세이브시간",
    variables: [
      { name: "임률", value: "389" },
      { name: "세이브시간", value: "0" },
    ],
  };
}

type FormState = {
  name: string;
  team: string;
  investmentCost: string;
  initialRecovered: string;
  /** 이 날짜까지는 위 누적 회수액으로 대신하고, 그 다음 날부터의 실적만 자동 계산한다. 빈 값이면 전체 계산. */
  initialRecoveredUntil: string;
  formula: string;
  variables: { name: string; value: string }[];
};

function toFormState(equipment: Equipment): FormState {
  return {
    name: equipment.name,
    team: equipment.team ?? "team2",
    investmentCost: String(equipment.investmentCost),
    initialRecovered: String(equipment.initialRecovered),
    initialRecoveredUntil: equipment.initialRecoveredUntil ?? "",
    formula: equipment.formula,
    variables: equipment.variables.map((variable) => ({
      name: variable.name,
      value: String(variable.value),
    })),
  };
}

function toPayload(form: FormState) {
  return {
    name: form.name,
    team: form.team,
    investmentCost: form.investmentCost,
    initialRecovered: form.initialRecovered,
    initialRecoveredUntil: form.initialRecoveredUntil || null,
    formula: form.formula,
    variables: form.variables
      .filter((variable) => variable.name.trim())
      .map((variable) => ({ name: variable.name, value: variable.value })) as unknown as FormulaVariable[],
  };
}

export default function EquipmentsPage() {
  const { data, loading, error, reload } = useAppData();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 팀 탭 — 설비도 팀별로 따로 관리한다. (기존 설비는 생산2팀 소속)
  const [selectedTeam, setSelectedTeam] = useState<string>("team2");

  const teamEquipments = useMemo(
    () => (data ? data.equipments.filter((equipment) => (equipment.team ?? "team2") === selectedTeam) : []),
    [data, selectedTeam],
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

  return (
    <div className="space-y-6">
      {!editor ? (
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-muted">
          지금은 조회만 가능합니다. 오른쪽 위 <strong>편집하기</strong>에서 비밀번호를 입력하면 설비와
          계산식을 수정할 수 있습니다.
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
            onClick={() => {
              setSelectedTeam(team.id);
              setAdding(false);
              setEditingId(null);
            }}
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

      <Card title="계산식에 쓸 수 있는 값">
        <ul className="space-y-1.5 text-sm">
          {BUILT_IN_VARIABLES.map((variable) => (
            <li key={variable.name} className="flex flex-wrap gap-2">
              <code className="rounded bg-page px-1.5 py-0.5 text-ink">{variable.name}</code>
              <span className="text-ink-muted">{variable.description}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">
          사용 가능한 기호: + - * / 와 괄호. 예) <code>수량 * 임률 * 세이브시간</code> (임률·세이브시간은
          설비마다 아래에서 직접 등록하는 값입니다)
        </p>
      </Card>

      {editor ? (
        <Card
          title="설비 추가"
          action={
            !adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-card"
              >
                새 설비 등록
              </button>
            ) : null
          }
        >
          {adding ? (
            <EquipmentForm
              initial={defaultForm(selectedTeam)}
              teams={data.teams}
              busy={busy}
              submitLabel="등록"
              onCancel={() => setAdding(false)}
              onSubmit={async (form) => {
                const succeeded = await run(() => apiSend("/api/equipments", "POST", toPayload(form)));
                if (succeeded) setAdding(false);
              }}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              자동화 설비를 등록하면 생산실적을 입력할 때 그 설비를 고를 수 있습니다.
            </p>
          )}
        </Card>
      ) : null}

      <Card title="설비 목록">
        {teamEquipments.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">등록된 설비가 없습니다.</p>
        ) : (
          <ul className="space-y-4">
            {teamEquipments.map((equipment) => (
              <li key={equipment.id} className="rounded-lg border border-line p-4">
                {editingId === equipment.id ? (
                  <EquipmentForm
                    initial={toFormState(equipment)}
                    teams={data.teams}
                    busy={busy}
                    submitLabel="저장"
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (form) => {
                      const succeeded = await run(() =>
                        apiSend(`/api/equipments/${equipment.id}`, "PATCH", toPayload(form)),
                      );
                      if (succeeded) setEditingId(null);
                    }}
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-medium text-ink">{equipment.name}</h3>
                      {editor ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(equipment.id)}
                            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(() => apiSend(`/api/equipments/${equipment.id}`, "DELETE"))
                            }
                            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft disabled:opacity-40"
                          >
                            삭제
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <dl className="tabular grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <div className="flex justify-between">
                        <dt className="text-ink-muted">투자비용</dt>
                        <dd className="text-ink-soft">{formatMoney(equipment.investmentCost)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-muted">시작 시점 누적 회수액</dt>
                        <dd className="text-ink-soft">{formatMoney(equipment.initialRecovered)}</dd>
                      </div>
                      {equipment.initialRecoveredUntil ? (
                        <div className="flex justify-between">
                          <dt className="text-ink-muted">누적 회수액 기준일</dt>
                          <dd className="text-ink-soft">
                            {equipment.initialRecoveredUntil}까지 (그 다음 날부터 실적 자동 계산)
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <p className="text-sm">
                      <span className="text-ink-muted">계산식: </span>
                      <code className="rounded bg-page px-1.5 py-0.5 text-ink">
                        {equipment.formula}
                      </code>
                    </p>

                    {equipment.variables.length > 0 ? (
                      <p className="text-sm text-ink-muted">
                        등록된 값:{" "}
                        {equipment.variables
                          .map((variable) => `${variable.name} = ${variable.value.toLocaleString("ko-KR")}`)
                          .join(", ")}
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

type FormProps = {
  initial: FormState;
  teams: { id: string; name: string }[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
};

function EquipmentForm({ initial, teams, busy, submitLabel, onSubmit, onCancel }: FormProps) {
  const [form, setForm] = useState<FormState>(initial);

  // 계산식에 썼지만 아직 값을 등록하지 않은 변수를 찾아 알려준다.
  const builtInNames = BUILT_IN_VARIABLES.map((variable) => variable.name);
  const used = extractVariables(form.formula);
  const known = new Set([...builtInNames, ...form.variables.map((variable) => variable.name.trim())]);
  const missing = used.filter((name) => !known.has(name));

  function update(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">설비 이름</span>
          <input
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="예: 자동 조립기 1호"
            className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">소속 팀</span>
          <select
            value={form.team}
            onChange={(event) => update({ team: event.target.value })}
            className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">설비 도입비용 (원)</span>
          <input
            type="number"
            min={0}
            value={form.investmentCost}
            onChange={(event) => update({ investmentCost: event.target.value })}
            placeholder="예: 50000000"
            className="tabular rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">시작 시점 누적 회수액 (원)</span>
          <input
            type="number"
            min={0}
            value={form.initialRecovered}
            onChange={(event) => update({ initialRecovered: event.target.value })}
            className="tabular rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">누적 회수액 기준일 (선택)</span>
          <DateField
            value={form.initialRecoveredUntil}
            onChange={(value) => update({ initialRecoveredUntil: value })}
            className="tabular rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
          />
          <span className="text-xs text-ink-muted">
            이 날짜까지는 위 누적 회수액으로 대신하고, 다음 날부터의 생산실적만 자동으로 계산해
            더합니다. 비워두면 전체 실적을 계산합니다.
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">회수액 계산식</span>
        <input
          value={form.formula}
          onChange={(event) => update({ formula: event.target.value })}
          className="rounded-md border border-line bg-card px-2 py-2 font-mono text-sm text-ink"
        />
      </label>

      <div className="space-y-2">
        <span className="text-xs text-ink-muted">계산식에서 쓰는 값</span>
        {form.variables.map((variable, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <input
              value={variable.name}
              onChange={(event) => {
                const next = [...form.variables];
                next[index] = { ...next[index], name: event.target.value };
                update({ variables: next });
              }}
              placeholder="값 이름"
              className="w-40 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
            />
            <span className="text-ink-muted">=</span>
            <input
              type="number"
              min={0}
              step="any"
              value={variable.value}
              onChange={(event) => {
                const next = [...form.variables];
                next[index] = { ...next[index], value: event.target.value };
                update({ variables: next });
              }}
              className="tabular w-40 rounded-md border border-line bg-card px-2 py-1.5 text-right text-sm text-ink"
            />
            <button
              type="button"
              onClick={() =>
                update({ variables: form.variables.filter((_, position) => position !== index) })
              }
              className="rounded-md border border-line px-2 py-1.5 text-sm text-ink-soft"
            >
              빼기
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ variables: [...form.variables, { name: "", value: "0" }] })}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft"
        >
          값 추가
        </button>
      </div>

      {missing.length > 0 ? (
        <p className="text-sm text-warning">
          계산식에 쓴 {missing.map((name) => `"${name}"`).join(", ")} 값이 아직 등록되지 않았습니다.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft"
        >
          취소
        </button>
      </div>
    </form>
  );
}
