import { $$ } from "./dom.js?v=20261009e";

/* =========================================================
   MARKDOWN — 처음 필요할 때만 불러옴. 버전 고정 + SRI, DOMPurify로 소독
   ========================================================= */
export const LIBS = {
  marked: { src: "https://cdn.jsdelivr.net/npm/marked@18.0.14/lib/marked.umd.js", sri: "sha384-2vpGtuKqJvFlwJqYnf/wUMuzUfhUnYBt9oay0e2yaFcq0Dh6/aEbQ8YAOeKGzlYo" },
  purify: { src: "https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js", sri: "sha384-a7SzOxErzJ3ZpQz0zJ32d67dSitNzPcbfybc/ykU9KJhMgZkwqfSxlhhdJRS+XGL" }
};

export const loadScript = ({ src, sri }) => new Promise((res, rej) => {
  const s = document.createElement("script");
  s.src = src; s.integrity = sri; s.crossOrigin = "anonymous";
  s.onload = res; s.onerror = () => rej(new Error("script load failed: " + src));
  document.head.append(s);
});

export let mdReady = null;

export function loadMarkdown(){
  return mdReady ||= Promise.all([loadScript(LIBS.marked), loadScript(LIBS.purify)]).then(() => {
    const m = window.marked, parse = (m.parse || m.marked?.parse).bind(m.marked || m);
    DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") || "") && !node.href.startsWith(location.origin)) node.setAttribute("rel", "noopener noreferrer");
      if (node.tagName === "IMG"){ node.setAttribute("loading", "lazy"); node.setAttribute("decoding", "async"); if (!node.hasAttribute("alt")) node.setAttribute("alt", ""); }
    });
    return text => {
      const html = DOMPurify.sanitize(parse(text, { gfm: true, breaks: true }), {
        FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"], FORBID_ATTR: ["style"]
      });
      // 본문 제목 단계를 한 칸 내림 — 페이지 제목(h1) 아래에 오도록 (WCAG 1.3.1)
      const t = document.createElement("template");
      t.innerHTML = html;
      $$("h1, h2, h3, h4, h5", t.content).reverse().forEach(h => {
        const n = document.createElement("h" + Math.min(6, +h.tagName[1] + 1));
        n.innerHTML = h.innerHTML; h.replaceWith(n);
      });
      return t.innerHTML;
    };
  }).catch(err => { mdReady = null; throw err; });
}

export async function renderMarkdown(text){ return (await loadMarkdown())(text || ""); }
