/* =========================================================
   진행 기록 편집 (관리자만, ‘편집’을 누를 때 불러옴)
   - 대사를 누르면: 화자·탭·표정·본문 고치기 / 삭제 / 아래에 새 대사 / ‘여기부터 BGM’
   - BGM 표시를 누르면: 고치기 / 삭제
   - 고친 내용은 모아 두었다가 ‘변경 저장’ 한 번에 새 파일로 올림 (이전 파일은 지움)
   ========================================================= */
import { publicUrl, refreshPublic, sb } from "./data.js?v=20261009e";
import { $, $$, announce, esc, toast } from "./dom.js?v=20261009e";
import { errMsg, withBusy } from "./forms.js?v=20261009e";
import { V, faceSrc, render, stopAudio } from "./logview.js?v=20261009e";
import { state } from "./state.js?v=20261009e";

const E = { dirty: 0, i: -1, k: -1 };

function bar(){
  let b = $("#log-editbar");
  if (!b){
    $(".log-box").insertAdjacentHTML("afterbegin", `
      <div class="log-editbar" id="log-editbar" role="region" aria-label="기록 편집">
        <span id="log-dirty" role="status">대사나 BGM 표시를 누르면 고칠 수 있습니다.</span>
        <span class="grow"></span>
        <button class="btn small" type="button" id="log-add-end">맨 끝에 대사 추가</button>
        <button class="btn small primary" type="button" id="log-save" disabled>변경 저장</button>
      </div>`);
    b = $("#log-editbar");
  }
  return b;
}
const dirty = n => {
  E.dirty += n;
  state.admDirty = E.dirty > 0;
  $("#log-save").disabled = !E.dirty;
  $("#log-dirty").textContent = E.dirty ? `저장하지 않은 변경 ${E.dirty}건` : "대사나 BGM 표시를 누르면 고칠 수 있습니다.";
};

export function toggleEdit(){
  if (!state.isAdmin || !V.log) return;
  if (V.editing && E.dirty && !confirm("저장하지 않은 변경이 있습니다. 편집을 끝낼까요? (변경은 화면에만 남고 저장되지 않습니다)")) return;
  V.editing = !V.editing;
  $("#log-edit").setAttribute("aria-pressed", String(V.editing));
  $("#log-body").classList.toggle("editing", V.editing);
  if (V.editing){ stopAudio(); bar().hidden = false; dirty(0); }
  else { bar().hidden = true; }
  announce(V.editing ? "편집 모드: 대사를 누르면 고칠 수 있습니다" : "편집 모드를 끝냈습니다");
}

/* ---------- 대화상자 ---------- */
function dialog(id, html){
  let d = document.getElementById(id);
  if (!d){ d = document.createElement("dialog"); d.id = id; d.className = "dlg"; document.body.append(d); }
  d.innerHTML = html;
  d.showModal();
  return d;
}

function faceChoices(s, cur){
  const log = V.log, list = [...new Set([...(log.sp[s][4] || []), ...(cur >= 0 ? [cur] : [])])];
  return `<fieldset class="face-pick"><legend>표정</legend>
    <label><input type="radio" name="face" value="-1" ${cur < 0 ? "checked" : ""}><span class="ph">없음</span></label>
    ${list.map(f => `<label><input type="radio" name="face" value="${f}" ${f === cur ? "checked" : ""}><img src="${esc(faceSrc(log, f))}" alt="표정 ${f + 1}" loading="lazy"></label>`).join("")}
  </fieldset>`;
}

function lineDialog(i, isNew = false){
  const log = V.log, [t, s, text, f = -1] = log.m[i];
  E.i = i;
  const d = dialog("dlg-line", `
    <form method="dialog" class="form" id="line-form">
      <h2 class="card-h">${isNew ? "새 대사" : `대사 고치기 <span class="muted num">#${i + 1}</span>`}</h2>
      <div class="row2">
        <div class="field"><label for="ln-sp">화자</label><select class="input" id="ln-sp">${log.sp.map(([n, , nr], k) => `<option value="${k}" ${k === s ? "selected" : ""}>${esc(n || "(이름 없음)")}${nr ? " · 나레이션" : ""}</option>`).join("")}</select></div>
        <div class="field"><label for="ln-tab">탭</label><select class="input" id="ln-tab">${log.tabs.map(([n], k) => `<option value="${k}" ${k === t ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
      </div>
      <div id="ln-faces">${faceChoices(s, f)}</div>
      <div class="field"><label for="ln-text">본문</label><textarea class="input" id="ln-text" rows="6" required>${esc(text)}</textarea>
        <span class="hint">꾸밈: **굵게** · *기울임* · {#e53935|색 글자}</span></div>
      <div class="form-actions">
        <button class="btn primary" type="submit" value="apply">적용</button>
        <button class="btn" type="button" data-act="below">아래에 새 대사</button>
        <button class="btn" type="button" data-act="bgm">여기부터 BGM</button>
        <button class="btn danger" type="button" data-act="del">삭제</button>
        <button class="btn" type="button" data-act="close">닫기</button>
      </div>
    </form>`);
  $("#ln-sp", d).addEventListener("change", e => { $("#ln-faces", d).innerHTML = faceChoices(+e.target.value, -1); });
  $("#ln-text", d).focus();
}

/* 대사 번호가 바뀌면 BGM 표시 위치도 같이 밀고 당김 */
const shiftBgm = (from, by) => { for (const b of V.log.bgm || []) if (b.at > from) b.at += by; };

function rerender(at){
  const pane = $("#log-pane");
  render({ upTo: at });
  const el = $(`#log-body [data-i="${at}"]`) || $(`#log-body [data-k="${at}"]`);
  if (el){ el.scrollIntoView({ block: "center" }); el.classList.add("just"); setTimeout(() => el.classList.remove("just"), 1600); }
  else pane.scrollTop = pane.scrollTop;
}

function applyLine(d){
  const log = V.log, i = E.i;
  const text = $("#ln-text", d).value.replace(/\r/g, "").trim();
  if (!text){ $("#ln-text", d).focus(); return false; }
  const face = +($('input[name="face"]:checked', d)?.value ?? -1);
  const next = [+$("#ln-tab", d).value, +$("#ln-sp", d).value, text, face], prev = log.m[i];
  if (prev.length === next.length && prev.every((v, k) => v === next[k]) && prev[2] !== "(새 대사)") return true;   // 바뀐 게 없으면 그대로
  log.m[i] = next;
  if (V.hidden.has(next[0])) V.hidden.delete(next[0]);
  dirty(1);
  return true;
}

/* ---------- BGM 표시 ---------- */
function bgmDialog(k, at){
  const b = k >= 0 ? V.log.bgm[k] : { at, kind: "audio", url: "", title: "", start: 0 };
  E.k = k; E.at = b.at;
  const d = dialog("dlg-bgm", `
    <form method="dialog" class="form" id="bgm-form">
      <h2 class="card-h">${k >= 0 ? "BGM 표시 고치기" : "여기부터 BGM"}</h2>
      <p class="hint">이 표시부터 다음 BGM 표시 전까지가 한 구간입니다. 읽는 사람이 ‘BGM 따라 듣기’를 켜면 구간마다 음악이 바뀝니다.</p>
      <fieldset class="log-fs"><legend>종류</legend>
        <label class="check"><input type="radio" name="kind" value="file" ${b.kind === "audio" && !/^https?:/.test(b.url) ? "checked" : ""}>음악 파일 올리기</label>
        <label class="check"><input type="radio" name="kind" value="audio" ${b.kind === "audio" && /^https?:/.test(b.url) ? "checked" : ""}>음악 파일 주소 (mp3 등)</label>
        <label class="check"><input type="radio" name="kind" value="youtube" ${b.kind === "youtube" ? "checked" : ""}>유튜브 링크 (읽는 사람이 눌러서 재생)</label>
        <label class="check"><input type="radio" name="kind" value="stop" ${b.kind === "stop" ? "checked" : ""}>음악 멈춤</label>
      </fieldset>
      <div class="field" data-for="file"><label for="bg-file">음악 파일</label><input type="file" id="bg-file" accept="audio/*">
        <span class="hint">${b.kind === "audio" && b.url && !/^https?:/.test(b.url) ? "지금 파일을 그대로 쓰려면 비워 두세요. " : ""}20MB 이하</span></div>
      <div class="field" data-for="audio youtube"><label for="bg-url">주소</label><input class="input" type="url" id="bg-url" value="${esc(/^https?:/.test(b.url) ? b.url : "")}" placeholder="https://…"></div>
      <div class="field" data-for="youtube"><label for="bg-start">시작 (초)</label><input class="input" type="number" id="bg-start" min="0" step="1" value="${+b.start || 0}"></div>
      <div class="field" data-for="file audio youtube"><label for="bg-title">곡 이름 (선택)</label><input class="input" type="text" id="bg-title" maxlength="80" value="${esc(b.title || "")}"></div>
      <p class="form-error" id="bg-err" role="alert" hidden></p>
      <div class="form-actions">
        <button class="btn primary" type="submit" value="apply">적용</button>
        ${k >= 0 ? `<button class="btn danger" type="button" data-act="bgm-del">삭제</button>` : ""}
        <button class="btn" type="button" data-act="close">닫기</button>
      </div>
    </form>`);
  const sync = () => { const v = $('input[name="kind"]:checked', d)?.value || "file"; $$("[data-for]", d).forEach(el => el.hidden = !el.dataset.for.split(" ").includes(v)); };
  if (!$('input[name="kind"]:checked', d)) $('input[value="file"]', d).checked = true;
  d.addEventListener("change", sync); sync();
}

const ytOk = u => /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/.test(u);

async function applyBgm(d){
  const err = m => { const el = $("#bg-err", d); el.textContent = m; el.hidden = !m; };
  const kind = $('input[name="kind"]:checked', d).value, cur = E.k >= 0 ? V.log.bgm[E.k] : null;
  const b = { at: E.at, kind: kind === "file" ? "audio" : kind, url: "", title: $("#bg-title", d).value.trim(), start: +$("#bg-start", d).value || 0 };
  if (kind === "file"){
    const f = $("#bg-file", d).files[0];
    if (!f){
      if (cur?.kind === "audio" && cur.url && !/^https?:/.test(cur.url)) b.url = cur.url;
      else return err("음악 파일을 골라 주세요."), false;
    } else {
      if (!/^audio\//.test(f.type)) return err("음악 파일만 올릴 수 있습니다."), false;
      if (f.size > 20 * 1024 * 1024) return err("20MB 이하 파일만 올릴 수 있습니다."), false;
      const path = `bgm/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(f.name.split(".").pop() || "mp3").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp3"}`;
      const up = await sb.storage.from("logs").upload(path, f, { contentType: f.type, cacheControl: "31536000", upsert: false });
      if (up.error) return err(errMsg(up.error)), false;
      b.url = path;
      if (!b.title) b.title = f.name.replace(/\.[^.]+$/, "");
    }
  } else if (kind === "audio"){
    b.url = $("#bg-url", d).value.trim();
    if (!/^https:\/\//.test(b.url)) return err("https:// 로 시작하는 음악 파일 주소를 넣어 주세요."), false;
  } else if (kind === "youtube"){
    b.url = $("#bg-url", d).value.trim();
    if (!ytOk(b.url)) return err("유튜브 링크를 넣어 주세요."), false;
  }
  V.log.bgm = V.log.bgm || [];
  if (E.k >= 0) V.log.bgm[E.k] = b; else V.log.bgm.push(b);
  V.log.bgm.sort((x, y) => x.at - y.at);
  dirty(1);
  return true;
}

/* ---------- 저장: 새 파일로 올리고 회차가 그 파일을 가리키게 한 뒤 이전 파일 삭제 ---------- */
async function save(){
  const c = V.chapter, log = V.log;
  if (!c || !E.dirty) return;
  const row = await sb.from("chapters").select("id, log_path").eq("id", c.id).single();
  if (row.error) throw row.error;
  log.n = log.m.length; log.v = 2;
  const blob = new Blob([JSON.stringify(log)], { type: "application/json" });
  const path = `ch-${c.id}-${Date.now()}.json`;
  const up = await sb.storage.from("logs").upload(path, blob, { contentType: "application/json", cacheControl: "31536000", upsert: false });
  if (up.error) throw up.error;
  const { error } = await sb.from("chapters").update({ log_path: path, updated_at: new Date().toISOString() }).eq("id", c.id);
  if (error){ sb.storage.from("logs").remove([path]); throw error; }
  if (row.data.log_path) sb.storage.from("logs").remove([row.data.log_path]);
  c.log = publicUrl("logs", path);
  E.dirty = 0; dirty(0);
  toast("기록을 저장했습니다");
  refreshPublic();
}

/* ---------- 이벤트 ---------- */
document.addEventListener("click", async e => {
  if (!V.editing) return;
  const t = e.target;
  if (t.closest("#log-save")) return withBusy(t.closest("#log-save"), () => save().catch(err => toast(errMsg(err))));
  if (t.closest("#log-add-end")){
    const last = V.log.m[V.log.m.length - 1] || [0, 0, "", -1];
    V.log.m.push([last[0], last[1], "(새 대사)", -1]);
    return lineDialog(V.log.m.length - 1, true);
  }
  const mark = t.closest("#log-body .lg-bgm");
  if (mark){ e.preventDefault(); e.stopPropagation(); return bgmDialog(+mark.dataset.k); }
  const line = t.closest("#log-body [data-i]");
  if (line) return lineDialog(+line.dataset.i);

  const d = t.closest("dialog.dlg");
  if (!d) return;
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "close"){
    if ($("#line-form", d) && V.log.m[E.i]?.[2] === "(새 대사)"){ V.log.m.splice(E.i, 1); shiftBgm(E.i, -1); }
    d.close(); return;
  }
  if (act === "del"){
    if (!confirm("이 대사를 삭제할까요?")) return;
    V.log.m.splice(E.i, 1); shiftBgm(E.i, -1); dirty(1); d.close(); rerender(Math.max(0, E.i - 1)); return;
  }
  if (act === "below"){
    if (!applyLine(d)) return;
    const [tt, ss] = V.log.m[E.i];
    V.log.m.splice(E.i + 1, 0, [tt, ss, "(새 대사)", -1]); shiftBgm(E.i, 1);
    rerender(E.i); lineDialog(E.i + 1, true); return;
  }
  if (act === "bgm"){ if (!applyLine(d)) return; d.close(); rerender(E.i); return bgmDialog(-1, E.i); }
  if (act === "bgm-del"){ V.log.bgm.splice(E.k, 1); dirty(1); d.close(); rerender(E.at); return; }
}, true);

document.addEventListener("submit", async e => {
  const f = e.target;
  if (f.id === "line-form"){
    e.preventDefault();
    if (applyLine(f.closest("dialog"))){ f.closest("dialog").close(); rerender(E.i); }
  }
  if (f.id === "bgm-form"){
    e.preventDefault();
    const btn = $('button[type="submit"]', f);
    await withBusy(btn, async () => { if (await applyBgm(f.closest("dialog"))){ f.closest("dialog").close(); rerender(E.at); } });
  }
});

// 편집 중 다른 화면으로 가면 편집 모드 해제
addEventListener("hashchange", () => { if (V.editing && !location.hash.startsWith("#story/")){ V.editing = false; $("#log-body")?.classList.remove("editing"); const b = $("#log-editbar"); if (b) b.hidden = true; $("#log-edit")?.setAttribute("aria-pressed", "false"); E.dirty = 0; state.admDirty = false; } });

