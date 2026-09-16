"use client";

/**
 * 관리자 설정
 * 지금은 편집 비밀번호 변경만 있다. 편집 모드가 아니면 접근할 수 없다.
 */

import { useState } from "react";
import Card from "@/components/Card";
import { apiSend, useAppData } from "@/lib/client";

export default function AdminPage() {
  const { data, loading, error } = useAppData();

  if (loading) return <p className="py-12 text-center text-sm text-ink-muted">불러오는 중…</p>;
  if (error || !data)
    return <p className="py-12 text-center text-sm text-critical">{error ?? "오류가 발생했습니다."}</p>;

  if (!data.editor) {
    return (
      <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-muted">
        관리자 설정은 편집 모드에서만 볼 수 있습니다. 오른쪽 위 <strong>편집하기</strong>에서 비밀번호를
        입력해주세요.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }

    setBusy(true);
    try {
      await apiSend("/api/auth", "PATCH", { currentPassword, newPassword });
      setDone(true);
      // 비밀번호가 바뀌면 편집 모드가 풀리므로, 화면을 새로 고쳐 로그인 폼을 다시 보여준다.
      setTimeout(() => window.location.reload(), 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "비밀번호를 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card title="편집 비밀번호 변경">
        <p className="text-sm text-good">
          비밀번호가 바뀌었습니다. 잠시 후 새 비밀번호로 다시 로그인해주세요.
        </p>
      </Card>
    );
  }

  return (
    <Card title="편집 비밀번호 변경">
      <form onSubmit={submit} className="max-w-sm space-y-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">현재 비밀번호</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">새 비밀번호</span>
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
            minLength={4}
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">새 비밀번호 확인</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="rounded-md border border-line bg-card px-2 py-2 text-sm text-ink"
            minLength={4}
            required
          />
        </label>

        {error ? <p className="text-sm text-critical">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
        >
          비밀번호 바꾸기
        </button>
      </form>
    </Card>
  );
}
