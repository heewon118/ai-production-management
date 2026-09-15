"use client";

/**
 * 로그인 화면
 *
 * 팀원 계정을 따로 만들지 않고, 회사 Microsoft 365(Azure AD) 계정으로 바로 로그인한다.
 * 버튼을 누르면 Supabase가 Microsoft 로그인 화면으로 이동시키고,
 * 로그인이 끝나면 /auth/callback으로 돌아온다.
 */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithMicrosoft() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email",
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    }
    // 성공하면 브라우저가 Microsoft 로그인 화면으로 이동하므로 여기서 할 일은 없다.
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-card p-8 text-center">
        <h1 className="text-lg font-semibold text-ink">AI 생산관리</h1>
        <p className="mt-2 text-sm text-ink-soft">
          회사 Microsoft 365 계정으로 로그인해주세요.
        </p>

        <button
          type="button"
          onClick={signInWithMicrosoft}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-card disabled:opacity-60"
        >
          {loading ? "이동 중..." : "Microsoft 계정으로 로그인"}
        </button>

        {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}
      </div>
    </div>
  );
}
