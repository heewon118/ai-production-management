/**
 * 서버 전용 Supabase 클라이언트 (secret key 사용, RLS를 우회한다)
 *
 * 절대 브라우저로 가는 코드(클라이언트 컴포넌트 등)에서 import하지 않는다.
 * 편집 권한 검사는 이 클라이언트가 아니라 `requireEditor()`(EDIT_PASSWORD)가 담당하며,
 * 이 클라이언트는 서버(API 라우트)에서 실제 데이터를 읽고 쓸 때만 쓴다.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !secretKey) {
  throw new Error(
    "SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL 환경변수가 설정되어 있지 않습니다.",
  );
}

const supabaseAdmin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export default supabaseAdmin;
