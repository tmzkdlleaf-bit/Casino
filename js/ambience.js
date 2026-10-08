import { BGM_KEY, CONFIG } from "./config.js?v=20261009c";
import { $ } from "./dom.js?v=20261009c";

/* =========================================================
   분위기 — 세계관 배경 + 배경음악
   ========================================================= */

/* 배경: 이미지는 한 번 그린 뒤 고정 (스크롤 중 다시 그리지 않음) */
export function initWorldBg(){
  const bg = $("#world-bg");
  if (CONFIG.BG_IMAGE){
    const img = new Image();
    img.alt = ""; img.decoding = "async"; img.fetchPriority = "low";
    img.onload = () => bg.classList.add("has-img");
    img.src = CONFIG.BG_IMAGE;
    bg.prepend(img);
  }
}

/* 배경음악: 방문자가 버튼을 누르기 전에는 재생하지 않음 (WCAG 1.4.2).
   지난 방문에 켜 두었다면 이번 방문의 첫 클릭 때 이어서 재생 */
let audio = null;
export function initBgm(){
  const btn = $("#bgm");
  if (!CONFIG.BGM_URL) return;
  btn.hidden = false;

  const set = on => btn.setAttribute("aria-pressed", String(on));
  const save = on => { try { localStorage.setItem(BGM_KEY, on ? "1" : "0"); } catch (_) {} };
  const play = () => {
    if (!audio){
      audio = new Audio(CONFIG.BGM_URL);
      audio.loop = true; audio.preload = "none"; audio.volume = CONFIG.BGM_VOLUME ?? .35;
    }
    return audio.play().then(() => set(true), () => set(false));
  };
  const stop = () => { audio?.pause(); set(false); };

  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-pressed") !== "true";
    save(on);
    on ? play() : stop();
  });

  let want = false;
  try { want = localStorage.getItem(BGM_KEY) === "1"; } catch (_) {}
  if (want){
    const once = e => { if (!e.target.closest?.("#bgm")) play(); };
    addEventListener("pointerdown", once, { once: true, capture: true });
  }

  // 진행 기록의 구간 BGM이 시작되면 사이트 배경음악은 멈춤
  document.addEventListener("comu:bgm-pause", () => { if (btn.getAttribute("aria-pressed") === "true") stop(); });

  // 다른 탭으로 가면 잠시 멈춤
  document.addEventListener("visibilitychange", () => {
    if (!audio || btn.getAttribute("aria-pressed") !== "true") return;
    document.hidden ? audio.pause() : audio.play().catch(() => set(false));
  });
}
