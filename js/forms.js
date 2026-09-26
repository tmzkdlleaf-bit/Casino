import { $$ } from "./dom.js";

/* =========================================================
   FORM — 검증·오류 표시·처리 중 상태 (접근성: aria-invalid + 오류 문구 연결)
   ========================================================= */
export const ERR_TEXT = [
  [/Invalid login credentials/i, "이메일 또는 비밀번호가 올바르지 않습니다."],
  [/Email not confirmed/i, "이메일 인증이 끝나지 않은 계정입니다."],
  [/rate limit|too many|429/i, "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요."],
  [/should be different/i, "기존과 다른 비밀번호를 입력해 주세요."],
  [/Password should|weak password/i, "더 길거나 복잡한 비밀번호를 사용해 주세요."],
  [/profiles_character_unique/i, "다른 멤버에게 이미 연결된 캐릭터입니다."],
  [/duplicate key.*slug|slug.*duplicate/i, "이미 쓰고 있는 주소(slug)입니다."],
  [/duplicate key|23505/i, "같은 값이 이미 있습니다."],
  [/foreign key|23503/i, "다른 곳에서 사용 중이라 처리할 수 없습니다. 연결된 항목을 먼저 정리해 주세요."],
  [/row-level security|permission denied|42501|JWT/i, "권한이 없습니다. 다시 로그인해 주세요."],
  [/Failed to fetch|NetworkError|timeout|Load failed/i, "연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요."],
  [/otp_expired|expired/i, "링크가 만료되었습니다. 비밀번호 재설정을 다시 요청하거나 관리자에게 초대를 다시 요청해 주세요."]
];

export function errMsg(e){
  const m = `${e?.message || ""} ${e?.code || ""} ${e?.details || ""}`.trim() || String(e || "");
  for (const [re, t] of ERR_TEXT) if (re.test(m)) return t;
  return /[가-힣]/.test(e?.message || "") ? e.message : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function fieldError(input, msg){
  input.setAttribute("aria-invalid", msg ? "true" : "false");
  const err = document.getElementById(input.id + "-err");
  if (err){ err.textContent = msg || ""; err.hidden = !msg; }
}

export function checkField(input){
  const v = input.validity;
  let msg = "";
  if (v.valueMissing) msg = input.type === "file" ? "파일을 선택해 주세요." : "필수 항목입니다.";
  else if (v.typeMismatch) msg = input.type === "email" ? "이메일 형식이 올바르지 않습니다." : "형식이 올바르지 않습니다.";
  else if (v.tooShort) msg = `${input.minLength}자 이상 입력해 주세요.`;
  else if (v.tooLong) msg = `${input.maxLength}자 이하로 입력해 주세요.`;
  else if (v.patternMismatch) msg = input.dataset.patternMsg || "형식이 올바르지 않습니다.";
  else if (v.rangeUnderflow) msg = `${input.min} 이상이어야 합니다.`;
  else if (v.rangeOverflow) msg = `${input.max} 이하여야 합니다.`;
  else if (v.stepMismatch || v.badInput) msg = "정수를 입력해 주세요.";
  // minlength는 사람이 직접 입력한 값만 검사하므로 직접 한 번 더 확인
  else if (input.minLength > 0 && input.value && input.value.length < input.minLength) msg = `${input.minLength}자 이상 입력해 주세요.`;
  fieldError(input, msg);
  return !msg;
}

export function validateForm(form){
  let first = null;
  $$("input, textarea, select", form).forEach(f => {
    if (f.type === "hidden" || f.hidden || f.disabled || !f.willValidate) return;
    if (!checkField(f) && !first) first = f;
  });
  first?.focus();
  return !first;
}

// 입력을 고치면 오류 표시를 바로 지움
document.addEventListener("input", e => { if (e.target.getAttribute?.("aria-invalid") === "true") checkField(e.target); });

/* 처리 중 버튼: disabled 대신 aria-disabled — disabled로 바꾸면 포커스가 사라짐 */
export async function withBusy(btn, fn){
  if (btn.getAttribute("aria-busy") === "true") return;
  const label = btn.textContent;
  btn.setAttribute("aria-busy", "true"); btn.setAttribute("aria-disabled", "true");
  btn.textContent = "처리 중…";
  try { return await fn(); }
  finally { btn.textContent = label; btn.removeAttribute("aria-busy"); btn.removeAttribute("aria-disabled"); }
}

export function showMsg(el, msg){ el.textContent = msg || ""; el.hidden = !msg; }
