/**
 * ROI(회수액) 계산식 파서
 *
 * PRD 규칙: 계산식은 사용자가 웹 화면에서 직접 입력한다 (코드에 하드코딩하지 않는다).
 * 사용자가 입력한 문자열을 안전하게 계산하기 위해, eval을 쓰지 않고 직접 파싱한다.
 *
 * 지원하는 문법: 숫자, 변수명(한글/영문), + - * / , 괄호, 단항 마이너스
 * 예) "절감시간 / 60 * 시간당인건비"
 */

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

/** 변수명에 쓸 수 있는 글자인지 (한글 완성형 + 영문 + 숫자 + 밑줄) */
function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_가-힣]/.test(ch);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // 숫자
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j += 1;
      const raw = source.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`숫자를 이해할 수 없습니다: "${raw}"`);
      }
      tokens.push({ type: "number", value });
      i = j;
      continue;
    }

    // 변수명
    if (isIdentChar(ch)) {
      let j = i;
      while (j < source.length && isIdentChar(source[j])) j += 1;
      tokens.push({ type: "ident", value: source.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i += 1;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i += 1;
      continue;
    }

    throw new Error(`계산식에 사용할 수 없는 문자가 있습니다: "${ch}"`);
  }

  return tokens;
}

/**
 * 재귀 하향 파서로 계산한다.
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := '-' factor | '(' expression ')' | 숫자 | 변수
 */
function parse(tokens: Token[], variables: Record<string, number>): number {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function parseExpression(): number {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.type === "op" && (token.value === "+" || token.value === "-")) {
        pos += 1;
        const right = parseTerm();
        left = token.value === "+" ? left + right : left - right;
        continue;
      }
      return left;
    }
  }

  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      const token = peek();
      if (token?.type === "op" && (token.value === "*" || token.value === "/")) {
        pos += 1;
        const right = parseFactor();
        if (token.value === "/") {
          if (right === 0) throw new Error("계산식에서 0으로 나눌 수 없습니다.");
          left = left / right;
        } else {
          left = left * right;
        }
        continue;
      }
      return left;
    }
  }

  function parseFactor(): number {
    const token = peek();
    if (!token) {
      throw new Error("계산식이 중간에 끊겼습니다. 수식을 다시 확인해주세요.");
    }

    // 단항 마이너스 (예: -3)
    if (token.type === "op" && token.value === "-") {
      pos += 1;
      return -parseFactor();
    }

    if (token.type === "number") {
      pos += 1;
      return token.value;
    }

    if (token.type === "ident") {
      pos += 1;
      if (!(token.value in variables)) {
        throw new Error(`계산식에 쓴 "${token.value}" 값이 없습니다. 설비 설정에서 값을 등록해주세요.`);
      }
      return variables[token.value];
    }

    if (token.type === "lparen") {
      pos += 1;
      const value = parseExpression();
      const next = peek();
      if (next?.type !== "rparen") {
        throw new Error("괄호가 닫히지 않았습니다.");
      }
      pos += 1;
      return value;
    }

    throw new Error("계산식을 이해할 수 없습니다. 수식을 다시 확인해주세요.");
  }

  const result = parseExpression();

  if (pos < tokens.length) {
    throw new Error("계산식에 불필요한 내용이 남아 있습니다. 수식을 다시 확인해주세요.");
  }
  if (!Number.isFinite(result)) {
    throw new Error("계산 결과가 올바른 숫자가 아닙니다.");
  }

  return result;
}

/** 계산식을 실제로 계산한다. 잘못된 식이면 에러를 던진다. */
export function evaluateFormula(expression: string, variables: Record<string, number>): number {
  if (!expression.trim()) {
    throw new Error("계산식이 비어 있습니다.");
  }
  return parse(tokenize(expression), variables);
}

/** 계산식 안에 등장하는 변수명 목록을 뽑아낸다. (화면에서 안내용으로 사용) */
export function extractVariables(expression: string): string[] {
  try {
    const names = tokenize(expression)
      .filter((token): token is { type: "ident"; value: string } => token.type === "ident")
      .map((token) => token.value);
    return [...new Set(names)];
  } catch {
    return [];
  }
}
