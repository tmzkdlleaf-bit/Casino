/* =========================================================
   이미지 → WebP (관리 화면 업로드 · 룰렛 자리 이미지)
   ========================================================= */
/* 이미지 → WebP (지원하지 않는 브라우저는 PNG/JPEG). 긴 변을 max px로 축소 */
export async function toWebP(file, max){
  if (!/^image\//.test(file.type)) throw new Error("이미지 파일만 올릴 수 있습니다.");
  if (file.size > 25 * 1024 * 1024) throw new Error("25MB 이하 이미지만 올릴 수 있습니다.");
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const enc = (type, q) => new Promise(r => c.toBlob(r, type, q));
  const webp = await enc("image/webp", .86);
  if (webp && webp.type === "image/webp") return webp;
  return file.type === "image/png" ? enc("image/png") : enc("image/jpeg", .88);
}

export const extOf = blob => ({ "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" })[blob.type] || "bin";

