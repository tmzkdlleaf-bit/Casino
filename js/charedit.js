/* =========================================================
   캐릭터 프로필 — 주인(또는 관리자)이 직접 수정 · 캐릭터 음악 재생
   수정 범위: 나이 · 키 · 성격 키워드 · 설명 · 링크 · 음악(유튜브)
   실제 권한 확인은 DB 함수 owner_update_character (supabase/update-6.sql)
   ========================================================= */
import { publicUrl, sb } from "./data.js?v=20261029e";
import { $, $$, esc, toast } from "./dom.js?v=20261029e";
import { errMsg, showMsg } from "./forms.js?v=20261029e";
import { nav } from "./state.js?v=20261029e";
import { ALL, canEdit, renderProfile, ytId } from "./views.js?v=20261029e";

const MAX_LINKS = 10;
const current = () => ALL().find(c => c.id === nav.lastProfile);

/* ---------- 음악 ---------- */
export function stopCharMusic(){
  const box = $("#pf-yt"), btn = $("#pf-play");
  if (box) box.innerHTML = "";
  if (btn){ btn.setAttribute("aria-pressed", "false"); $(".lb", btn).textContent = "음악 재생"; }
}
function playCharMusic(){
  const c = current(), id = c && ytId(c.bgm), box = $("#pf-yt"), btn = $("#pf-play");
  if (!id || !box) return;
  document.dispatchEvent(new Event("comu:bgm-pause"));   // 사이트 배경음악은 멈춤
  box.innerHTML = `<iframe title="${esc(c.name)} 캐릭터 음악" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&loop=1&playlist=${id}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  btn.setAttribute("aria-pressed", "true"); $(".lb", btn).textContent = "음악 끄기";
}
document.addEventListener("click", e => {
  const b = e.target.closest("#pf-play");
  if (!b) return;
  b.getAttribute("aria-pressed") === "true" ? stopCharMusic() : playCharMusic();
});

/* ---------- 게임용 이미지 (룰렛 자리) — 캐릭터 이미지와 따로 ---------- */
let gimg = { path: "", file: null };
async function loadGameImg(c){
  gimg = { path: "", file: null };
  $("#pe-gimg").value = ""; $("#pe-gimg-del").checked = false;
  const prev = $("#pe-gimg-prev");
  prev.innerHTML = `<span aria-hidden="true">…</span>`;
  const { data } = await sb.from("roulette_avatars").select("path").eq("character_id", c.uuid).maybeSingle();
  gimg.path = data?.path || "";
  prev.innerHTML = gimg.path ? `<img src="${esc(publicUrl("roulette", gimg.path))}" alt="현재 게임용 이미지">` : `<span aria-hidden="true">없음</span>`;
  $("#pe-gimg-del-l").hidden = !gimg.path;
}
$("#pe-gimg").addEventListener("change", e => {
  const f = e.target.files[0];
  if (f && !/^image\//.test(f.type)){ e.target.value = ""; return; }
  gimg.file = f || null;
  if (f) $("#pe-gimg-prev").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="새로 올릴 게임용 이미지">`;
});
async function saveGameImg(c){
  if (gimg.file){
    const { toWebP, extOf } = await import("./img.js?v=20261029e");
    const blob = await toWebP(gimg.file, 512), path = `${c.uuid}/${Date.now()}.${extOf(blob)}`;
    const up = await sb.storage.from("roulette").upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (up.error) throw up.error;
    const { error } = await sb.rpc("roulette_set_avatar", { p_character: c.uuid, p_path: path });
    if (error){ sb.storage.from("roulette").remove([path]); throw error; }
    if (gimg.path) sb.storage.from("roulette").remove([gimg.path]);
  } else if ($("#pe-gimg-del").checked && gimg.path){
    const { error } = await sb.rpc("roulette_set_avatar", { p_character: c.uuid, p_path: null });
    if (error) throw error;
    sb.storage.from("roulette").remove([gimg.path]);
  }
}

/* ---------- 수정 창 ---------- */
const dlg = $("#pf-dlg"), form = $("#pf-form");

const linkRow = (l = {}, i = 0) => `<div class="pe-link" data-link>
  <label class="sr" for="pl-n-${i}">링크 이름</label><input class="input" id="pl-n-${i}" data-k="label" maxlength="40" placeholder="이름 (예: 캐입 계정)" value="${esc(l.label || "")}">
  <label class="sr" for="pl-u-${i}">링크 주소</label><input class="input" id="pl-u-${i}" data-k="url" type="url" inputmode="url" maxlength="500" placeholder="https://…" value="${esc(l.url || "")}">
  <button class="btn small danger" type="button" data-link-del aria-label="이 링크 삭제">삭제</button>
</div>`;
let seq = 0;
const syncAdd = () => { $("#pe-link-add").disabled = $$("#pe-links [data-link]").length >= MAX_LINKS; };

function openEdit(){
  const c = current();
  if (!canEdit(c)) return;
  showMsg($("#pf-form-err"), "");
  $("#pf-dlg-h").textContent = `${c.name} 수정`;
  $("#pe-age").value = c.age || "";
  $("#pe-height").value = c.height || "";
  $("#pe-kw").value = (c.keywords || []).join(", ");
  $("#pe-desc").value = c.description || "";
  $("#pe-bgm").value = c.bgm || "";
  $("#pe-links").innerHTML = (c.links || []).map(l => linkRow(l, seq++)).join("");
  syncAdd();
  loadGameImg(c);
  dlg.showModal();
  $("#pe-age").focus();
}

async function save(){
  const c = current(), err = $("#pf-form-err");
  showMsg(err, "");
  const links = $$("#pe-links [data-link]").map(el => ({ label: $('[data-k="label"]', el).value.trim(), url: $('[data-k="url"]', el).value.trim() })).filter(l => l.url || l.label);
  const bad = links.find(l => !/^https?:\/\/\S+$/i.test(l.url));
  if (bad){ showMsg(err, `링크 주소는 http:// 또는 https:// 로 시작해야 합니다: ${bad.label || bad.url || "(빈 주소)"}`); return; }
  const bgm = $("#pe-bgm").value.trim();
  if (bgm && !ytId(bgm)){ showMsg(err, "음악은 유튜브 영상 링크만 넣을 수 있습니다."); $("#pe-bgm").focus(); return; }
  const keywords = $("#pe-kw").value.split(/[,，、]/).map(t => t.trim()).filter(Boolean);
  const vals = { age: $("#pe-age").value.trim(), height: $("#pe-height").value.trim(), keywords, description: $("#pe-desc").value.trim(), links, bgm };

  const btn = $("#pe-save");
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  const { error } = await sb.rpc("owner_update_character", {
    p_id: c.uuid, p_age: vals.age, p_height: vals.height, p_keywords: keywords,
    p_description: vals.description, p_links: links, p_bgm_url: bgm
  });
  btn.disabled = false; btn.removeAttribute("aria-busy");
  if (error){
    const missing = /PGRST202|owner_update_character|42883/.test(`${error.code} ${error.message}`);
    showMsg(err, missing ? "수정 기능이 아직 준비되지 않았습니다. 관리자가 supabase/update-6.sql을 실행해야 합니다." : errMsg(error));
    return;
  }
  try { await saveGameImg(c); }
  catch (e2){ btn.disabled = false; showMsg(err, "다른 내용은 저장했지만 게임용 이미지는 올리지 못했습니다: " + errMsg(e2)); Object.assign(c, vals); return; }
  Object.assign(c, vals);              // 화면 데이터 바로 갱신 (다른 사람에게는 새로 고침 때 반영)
  dlg.close();
  stopCharMusic();
  renderProfile(c.id, { quiet: true });
  toast("저장했습니다");
}

$("#pf-edit").addEventListener("click", openEdit);
$("#pe-cancel").addEventListener("click", () => dlg.close());
$("#pe-link-add").addEventListener("click", () => {
  $("#pe-links").insertAdjacentHTML("beforeend", linkRow({}, seq++));
  syncAdd();
  $$("#pe-links [data-link]").at(-1).querySelector("input").focus();
});
$("#pe-links").addEventListener("click", e => {
  const d = e.target.closest("[data-link-del]");
  if (!d) return;
  d.closest("[data-link]").remove();
  syncAdd();
  $("#pe-link-add").focus();
});
form.addEventListener("submit", e => { e.preventDefault(); save(); });
