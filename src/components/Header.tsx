"use client";

/**
 * 상단 메뉴 + 편집 모드 전환
 *
 * PRD 규칙: 조회는 비밀번호 없이 누구나, 편집은 비밀번호를 넣어야 가능하다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiSend } from "@/lib/client";

const MENUS = [
  { href: "/", label: "대시보드" },
  { href: "/production", label: "생산실적입력" },
  { href: "/processes", label: "공정 설정" },
  { href: "/equipments", label: "자동화 설비 설정" },
];

export default function Header() {
  const pathname = usePathname();
  const [editor, setEditor] = useState(false);
  // 관리자(편집 모드)가 아니면 대시보드만 보이게 한다.
  const visibleMenus = editor ? MENUS : MENUS.filter((menu) => menu.href === "/");
  const [password, setPassword] = useState("");
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { editor: boolean }) => setEditor(result.editor))
      .catch(() => setEditor(false));
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiSend("/api/auth", "POST", { password });
      // 열려 있는 화면들이 편집 가능한 상태로 다시 그려지도록 새로고침한다.
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
    }
  }

  async function logout() {
    await apiSend("/api/auth", "DELETE");
    window.location.reload();
  }

  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="text-base font-semibold text-ink">
          생산기술1팀
        </Link>

        <nav className="flex flex-wrap gap-1">
          {visibleMenus.map((menu) => {
            const active = pathname === menu.href;
            return (
              <Link
                key={menu.href}
                href={menu.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-ink text-card font-medium"
                    : "text-ink-soft hover:bg-page hover:text-ink"
                }`}
              >
                {menu.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href="/api/export"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:text-ink"
          >
            데이터 내보내기
          </a>

          {editor ? (
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-good/10 px-2 py-1 text-xs font-medium text-good">
                편집 모드
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:text-ink"
              >
                잠그기
              </button>
            </div>
          ) : opened ? (
            <form onSubmit={login} className="flex items-center gap-2">
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="편집 비밀번호"
                className="w-36 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
              />
              <button
                type="submit"
                className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-card"
              >
                확인
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setOpened(true)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:text-ink"
            >
              편집하기
            </button>
          )}
        </div>

        {error ? <p className="w-full text-sm text-critical">{error}</p> : null}
      </div>
    </header>
  );
}
