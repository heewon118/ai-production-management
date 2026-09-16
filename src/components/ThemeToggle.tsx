"use client";

/**
 * 다크모드/라이트모드 전환 버튼.
 * 기본은 시스템(브라우저) 설정을 따르고, 여기서 직접 고르면 그 값을 localStorage에
 * 저장해 시스템 설정보다 우선한다(layout.tsx의 인라인 스크립트가 다음 방문 때도
 * 화면이 그려지기 전에 미리 적용해 깜빡임을 막는다).
 *
 * localStorage·matchMedia처럼 리액트 바깥에 있는 값을 읽어야 하므로,
 * useState+useEffect 대신 useSyncExternalStore로 구독한다(서버 렌더와의
 * 첫 화면 불일치도 이 훅이 알아서 처리해준다).
 */

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const THEME_CHANGE_EVENT = "app-theme-change";

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function getSnapshot(): Theme {
  try {
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // 저장이 안 되면 시스템 설정으로 본다.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 서버에는 시스템 설정을 알 방법이 없으니, 화면이 그려진 뒤 클라이언트 값으로 바로 맞춘다. */
function getServerSnapshot(): Theme {
  return "light";
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem("theme", next);
    } catch {
      // 브라우저가 저장을 막아도 화면은 그대로 동작한다.
    }
    // localStorage의 storage 이벤트는 다른 탭에서만 울리므로, 지금 이 탭에도 직접 알려준다.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  const label = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-soft hover:text-ink"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** 지금 다크 모드일 때 보여준다 (누르면 라이트 모드로 바뀐다). */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
    </svg>
  );
}

/** 지금 라이트 모드일 때 보여준다 (누르면 다크 모드로 바뀐다). */
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M20.4 14.7A8.5 8.5 0 0 1 9.3 3.6a.6.6 0 0 0-.7-.8A9.5 9.5 0 1 0 21.2 15.4a.6.6 0 0 0-.8-.7Z" />
    </svg>
  );
}
