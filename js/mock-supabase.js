/* =========================================================
   테스트용 가짜 Supabase — 실제 사이트 DB에는 전혀 연결하지 않음
   - 표(테이블)는 이 브라우저의 localStorage, 올린 파일은 IndexedDB에만 저장
   - 사이트 코드(js/*.js)는 실제 저장소 것을 그대로 씀. 이 파일만 바꿔 끼움
   ========================================================= */
(() => {
  const TABLE_KEY = "logtest-tables-v1";
  const ADMIN = { id: "u-admin", email: "admin@titfortat777.invalid" };
  const now = () => new Date().toISOString();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));

  /* ---------- 처음 들어갈 더미 데이터 ---------- */
  /* 샘플 로그: 표정이 여러 개인 캐릭터 셋 + 배경 두 장 (그림은 테스트용 단순 그림) */
  const SAMPLE_LOG = {"v": 2, "src": "샘플 로그 (테스트용)", "n": 22, "tabs": [["main", "main"], ["info", "info"], ["other", "other"]], "faces": ["data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%23EF1A72%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%232b1b2e%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Ccircle cx=%22176%22 cy=%22196%22 r=%229%22/%3E%3Ccircle cx=%22224%22 cy=%22196%22 r=%229%22/%3E%3C/g%3E%3Cpath d=%22M188 238h24%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EB%B0%B1%EC%95%BC %C2%B7 %EA%B8%B0%EB%B3%B8%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%23EF1A72%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%232b1b2e%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Cpath d=%22M164 198q12-12 24 0M212 198q12-12 24 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%226%22 stroke-linecap=%22round%22/%3E%3C/g%3E%3Cpath d=%22M182 232q18 18 36 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E%3Cellipse cx=%22160%22 cy=%22222%22 rx=%2212%22 ry=%226%22 fill=%22%23ff7fb0%22 opacity=%22.6%22/%3E%3Cellipse cx=%22240%22 cy=%22222%22 rx=%2212%22 ry=%226%22 fill=%22%23ff7fb0%22 opacity=%22.6%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EB%B0%B1%EC%95%BC %C2%B7 %EC%9B%83%EC%9D%8C%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%23EF1A72%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%232b1b2e%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Ccircle cx=%22176%22 cy=%22194%22 r=%2213%22 fill=%22%23fff%22 stroke=%22%231a1a2e%22 stroke-width=%225%22/%3E%3Ccircle cx=%22224%22 cy=%22194%22 r=%2213%22 fill=%22%23fff%22 stroke=%22%231a1a2e%22 stroke-width=%225%22/%3E%3Ccircle cx=%22176%22 cy=%22194%22 r=%225%22/%3E%3Ccircle cx=%22224%22 cy=%22194%22 r=%225%22/%3E%3C/g%3E%3Cellipse cx=%22200%22 cy=%22240%22 rx=%2210%22 ry=%2214%22 fill=%22%231a1a2e%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EB%B0%B1%EC%95%BC %C2%B7 %EB%86%80%EB%9E%8C%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%23EF1A72%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%232b1b2e%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Cpath d=%22M160 180l28 10M240 180l-28 10%22 stroke=%22%231a1a2e%22 stroke-width=%226%22 stroke-linecap=%22round%22/%3E%3Ccircle cx=%22178%22 cy=%22202%22 r=%228%22/%3E%3Ccircle cx=%22222%22 cy=%22202%22 r=%228%22/%3E%3C/g%3E%3Cpath d=%22M184 244q16-12 32 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EB%B0%B1%EC%95%BC %C2%B7 %ED%99%94%EB%82%A8%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%235D97D9%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%23d9d2c3%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Ccircle cx=%22176%22 cy=%22196%22 r=%229%22/%3E%3Ccircle cx=%22224%22 cy=%22196%22 r=%229%22/%3E%3C/g%3E%3Cpath d=%22M188 238h24%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EC%84%9C%EB%A6%B0 %C2%B7 %EA%B8%B0%EB%B3%B8%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%235D97D9%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%23d9d2c3%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Cpath d=%22M164 200h24M212 200h24%22 stroke=%22%231a1a2e%22 stroke-width=%226%22 stroke-linecap=%22round%22/%3E%3C/g%3E%3Cpath d=%22M190 240q10 6 20 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EC%84%9C%EB%A6%B0 %C2%B7 %ED%95%9C%EC%88%A8%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%235D97D9%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%23d9d2c3%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Cpath d=%22M164 198q12-12 24 0M212 198q12-12 24 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%226%22 stroke-linecap=%22round%22/%3E%3C/g%3E%3Cpath d=%22M182 232q18 18 36 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E%3Cellipse cx=%22160%22 cy=%22222%22 rx=%2212%22 ry=%226%22 fill=%22%23ff7fb0%22 opacity=%22.6%22/%3E%3Cellipse cx=%22240%22 cy=%22222%22 rx=%2212%22 ry=%226%22 fill=%22%23ff7fb0%22 opacity=%22.6%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EC%84%9C%EB%A6%B0 %C2%B7 %EC%9B%83%EC%9D%8C%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%231D367B%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%230b0b14%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Ccircle cx=%22176%22 cy=%22196%22 r=%229%22/%3E%3Ccircle cx=%22224%22 cy=%22196%22 r=%229%22/%3E%3C/g%3E%3Cpath d=%22M188 238h24%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EB%A0%88%EC%9D%B4 %C2%B7 %EA%B8%B0%EB%B3%B8%3C/text%3E%3C/svg%3E", "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 980%22%3E %3Cpath d=%22M70 980c0-260 40-470 130-500 90 30 130 240 130 500z%22 fill=%22%231D367B%22/%3E %3Cpath d=%22M150 470h100l-50 90z%22 fill=%22%23eef3fa%22/%3E %3Crect x=%22176%22 y=%22270%22 width=%2248%22 height=%2270%22 fill=%22%23f5dccb%22/%3E %3Ccircle cx=%22200%22 cy=%22200%22 r=%2292%22 fill=%22%23f5dccb%22/%3E %3Cpath d=%22M104 196c0-80 44-112 96-112s96 32 96 112c-20-40-60-58-96-58s-76 18-96 58z%22 fill=%22%230b0b14%22/%3E %3Cg fill=%22%231a1a2e%22%3E%3Cpath d=%22M164 198q12-12 24 0M212 198q12-12 24 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%226%22 stroke-linecap=%22round%22/%3E%3C/g%3E%3Cpath d=%22M182 232q18 18 36 0%22 fill=%22none%22 stroke=%22%231a1a2e%22 stroke-width=%225%22 stroke-linecap=%22round%22/%3E%3Cellipse cx=%22160%22 cy=%22222%22 rx=%2212%22 ry=%226%22 fill=%22%23ff7fb0%22 opacity=%22.6%22/%3E%3Cellipse cx=%22240%22 cy=%22222%22 rx=%2212%22 ry=%226%22 fill=%22%23ff7fb0%22 opacity=%22.6%22/%3E %3Crect x=%22120%22 y=%22900%22 width=%22160%22 height=%2244%22 rx=%224%22 fill=%22%23000%22 opacity=%22.55%22/%3E %3Ctext x=%22200%22 y=%22931%22 font-family=%22sans-serif%22 font-size=%2224%22 fill=%22%23fff%22 text-anchor=%22middle%22%3E%EB%A0%88%EC%9D%B4 %C2%B7 %EB%AF%B8%EC%86%8C%3C/text%3E%3C/svg%3E"], "sp": [["진행", "#888888", 1, -1, []], ["백야", "#EF1A72", 0, 0, [0, 1, 2, 3]], ["서린", "#5D97D9", 0, 4, [4, 5, 6]], ["딜러 레이", "#ADCFEA", 0, 7, [7, 8]], ["system", "#888888", 0, -1, []]], "m": [[0, 4, "[ 백야 ] 님이 입장했습니다.", -1], [0, 0, "샹들리에 아래, 초록 펠트가 깔린 테이블 위로 칩이 소리 없이 쌓여 있다.\n딜러는 고개를 숙인 채 카드를 섞는다.", -1], [0, 3, "어서 오세요. Titfortat777에 처음 오셨나요?", 8], [0, 1, "처음은 아니야.", 0], [0, 1, "**딱 한 판만** 하러 왔어.", 1], [0, 2, "또 그 소리. 지난번에도 *딱 한 판*이었잖아.", 5], [0, 1, "이번엔 진짜야!", 3], [0, 3, "그럼 자리로 안내해 드리죠.", 7], [1, 0, "블랙잭 테이블이 열렸습니다. 판돈은 블루 코인으로 겁니다.", -1], [0, 0, "테이블 너머, 딜러의 소매 끝에 {#EF1A72|붉은 얼룩}이 묻어 있다.", -1], [0, 1, "……잠깐, 그거 뭐야?", 2], [0, 3, "무엇을 보고 계신가요, 손님?", 8], [0, 1, "아무것도.", 0], [2, 1, "(잠깐 화장실 다녀옴)", 0], [2, 2, "ㅋㅋㅋ 다녀와", 6], [0, 0, "──── 장면 전환 ────", -1], [0, 0, "두꺼운 커튼 너머, VIP 룸. 음악이 낮게 깔린다.", -1], [0, 2, "여기까지 따라올 줄은 몰랐네.", 4], [0, 2, "…돌아가자. 오늘 운은 여기까지야.", 5], [0, 1, "싫어. 끝까지 볼 거야.", 3], [0, 3, "좋습니다. 그럼 마지막 판을 시작하죠.", 8], [0, 0, "카드가 한 장씩 펼쳐진다.", -1]], "bgm": [{"at": 1, "kind": "youtube", "url": "https://www.youtube.com/watch?v=jfKfPfyJRdk", "title": "로비 음악 (샘플)", "start": 0}, {"at": 15, "kind": "stop"}], "bg": [{"at": 1, "url": "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1600 900%22 preserveAspectRatio=%22xMidYMid slice%22%3E %3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%220%22 y2=%221%22%3E%3Cstop offset=%220%22 stop-color=%22%2305060f%22/%3E%3Cstop offset=%22.6%22 stop-color=%22%231D367B%22/%3E%3Cstop offset=%221%22 stop-color=%22%230E1B45%22/%3E%3C/linearGradient%3E%3C/defs%3E %3Crect width=%221600%22 height=%22900%22 fill=%22url(%23g)%22/%3E%3Ccircle cx=%22800%22 cy=%22120%22 r=%2226%22 fill=%22%23ffe9a8%22 opacity=%22.8%22/%3E%3Ccircle cx=%22740%22 cy=%22160%22 r=%2210%22 fill=%22%23ffe9a8%22 opacity=%22.8%22/%3E%3Ccircle cx=%22860%22 cy=%22160%22 r=%2210%22 fill=%22%23ffe9a8%22 opacity=%22.8%22/%3E%3Ccircle cx=%22700%22 cy=%22200%22 r=%226%22 fill=%22%23ffe9a8%22 opacity=%22.8%22/%3E%3Ccircle cx=%22900%22 cy=%22200%22 r=%226%22 fill=%22%23ffe9a8%22 opacity=%22.8%22/%3E%3Ccircle cx=%22800%22 cy=%22210%22 r=%228%22 fill=%22%23ffe9a8%22 opacity=%22.8%22/%3E%3Crect y=%22640%22 width=%221600%22 height=%22260%22 fill=%22%230e3b2e%22/%3E%3Cellipse cx=%22800%22 cy=%22700%22 rx=%22520%22 ry=%2290%22 fill=%22%23146b4c%22/%3E %3Ctext x=%221560%22 y=%2260%22 font-family=%22sans-serif%22 font-size=%2230%22 fill=%22%23fff%22 opacity=%22.5%22 text-anchor=%22end%22%3E%EB%A1%9C%EB%B9%84 (%EC%83%98%ED%94%8C %EB%B0%B0%EA%B2%BD)%3C/text%3E%3C/svg%3E", "title": "로비"}, {"at": 15, "url": "", "title": ""}, {"at": 16, "url": "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1600 900%22 preserveAspectRatio=%22xMidYMid slice%22%3E %3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%220%22 y2=%221%22%3E%3Cstop offset=%220%22 stop-color=%22%2312030b%22/%3E%3Cstop offset=%22.6%22 stop-color=%22%234a0c2a%22/%3E%3Cstop offset=%221%22 stop-color=%22%231a0610%22/%3E%3C/linearGradient%3E%3C/defs%3E %3Crect width=%221600%22 height=%22900%22 fill=%22url(%23g)%22/%3E%3Crect x=%22120%22 y=%22120%22 width=%22260%22 height=%22520%22 fill=%22%232a0a1e%22 opacity=%22.7%22/%3E%3Crect x=%221220%22 y=%22120%22 width=%22260%22 height=%22520%22 fill=%22%232a0a1e%22 opacity=%22.7%22/%3E%3Crect y=%22700%22 width=%221600%22 height=%22200%22 fill=%22%231a0610%22/%3E %3Ctext x=%221560%22 y=%2260%22 font-family=%22sans-serif%22 font-size=%2230%22 fill=%22%23fff%22 opacity=%22.5%22 text-anchor=%22end%22%3EVIP %EB%A3%B8 (%EC%83%98%ED%94%8C %EB%B0%B0%EA%B2%BD)%3C/text%3E%3C/svg%3E", "title": "VIP 룸"}]};
  SAMPLE_LOG.n = SAMPLE_LOG.m.length;

  const SEED = () => ({
    profiles: [{ id: ADMIN.id, email: ADMIN.email, display_name: "테스트 관리자", role: "admin", reduce_motion: false, created_at: now() }],
    characters: [
      { id: "c1", slug: "d1", name: "딜러 레이", kind: "dealer", suit: "spade", chip_color: "red", role_title: "딜러", age: "", height: "", keywords: [], description: "테스트용 직원", sort_order: 1, owner_id: null, image_path: null, thumb_path: null },
      { id: "c2", slug: "p1", name: "백야", kind: "player", suit: "heart", chip_color: "green", role_title: "", age: "", height: "", keywords: [], description: "테스트용 참가자", sort_order: 2, owner_id: ADMIN.id, image_path: null, thumb_path: null },
      { id: "c3", slug: "p2", name: "서린", kind: "player", suit: "club", chip_color: "", role_title: "", age: "", height: "", keywords: [], description: "테스트용 참가자", sort_order: 3, owner_id: null, image_path: null, thumb_path: null }
    ],
    chapters: [
      { id: "ch1", number: 1, title: "붉은 테이블 (샘플 로그)", summary: "샘플 로그가 붙어 있는 회차입니다.", body: "", played_on: "2026-10-01", log_path: "sample/ep1.json", updated_at: now() },
      { id: "ch2", number: 2, title: "테스트용 빈 회차", summary: "관리 → 지난 이야기에서 여기에 로그를 올려 보세요.", body: "", played_on: "2026-10-30", log_path: null, updated_at: now() }
    ],
    items: [], chip_balances: [{ character_id: "c2", balance: 100, pink: 20 }], inventory: [],
    game_records: [], game_slots: [], shop_requests: [], chip_requests: []
  });

  let T;
  try { T = JSON.parse(localStorage.getItem(TABLE_KEY)) || SEED(); } catch (_) { T = SEED(); }
  const persist = () => { try { localStorage.setItem(TABLE_KEY, JSON.stringify(T)); } catch (_) {} };
  /* 테스트 멤버 둘: '보는 사람'을 바꿔서 비밀 탭이 가려지는지 확인용 */
  const MEMBERS = [
    { id: "u-m1", email: "member1@titfortat777.invalid", display_name: "테스트 멤버 1", role: "member", reduce_motion: false },
    { id: "u-m2", email: "member2@titfortat777.invalid", display_name: "테스트 멤버 2", role: "member", reduce_motion: false }
  ];
  for (const m of MEMBERS) if (!T.profiles.some(p => p.id === m.id)) T.profiles.push({ ...m, created_at: now() });
  T.log_secrets ??= [];

  /* ---------- 파일 저장소: IndexedDB (없으면 메모리만) ---------- */
  const files = new Map();   // "버킷/경로" → blob URL
  const blobs = new Map();
  let idb = null;
  const openDb = () => new Promise(res => {
    try {
      const r = indexedDB.open("logtest-files", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("f");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (_) { res(null); }
  });
  const idbAll = db => new Promise(res => {
    if (!db) return res([]);
    try {
      const out = [], tx = db.transaction("f").objectStore("f").openCursor();
      tx.onsuccess = () => { const c = tx.result; if (c){ out.push([c.key, c.value]); c.continue(); } else res(out); };
      tx.onerror = () => res(out);
    } catch (_) { res([]); }
  });
  const idbPut = (k, v) => { try { idb?.transaction("f", "readwrite").objectStore("f").put(v, k); } catch (_) {} };
  const idbDel = k => { try { idb?.transaction("f", "readwrite").objectStore("f").delete(k); } catch (_) {} };
  const putFile = (key, blob, save = true) => {
    if (files.has(key)) URL.revokeObjectURL(files.get(key));
    blobs.set(key, blob); files.set(key, URL.createObjectURL(blob));
    if (save) idbPut(key, blob);
  };
  const READY = (async () => {
    idb = await openDb();
    for (const [k, v] of await idbAll(idb)) putFile(k, v, false);
    putFile("logs/sample/ep1.json", new Blob([JSON.stringify(SAMPLE_LOG)], { type: "application/json" }), false);
  })();

  /* ---------- 표 조회 흉내 ---------- */
  const relations = sel => [...String(sel || "").matchAll(/([a-z_]+)\s*\(/g)].map(m => m[1]);
  const cmp = (a, b) => a == null ? (b == null ? 0 : -1) : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0;

  class Query {
    constructor(table){ this.t = table; this.f = []; this.ord = []; this.lim = null; this.mode = "select"; this.one = null; this.sel = "*"; this.opts = {}; }
    select(cols = "*", opts = {}){ if (this.mode === "select") this.sel = cols; this.returning = true; this.opts = opts; return this; }
    insert(v){ this.mode = "insert"; this.val = v; return this; }
    upsert(v, o = {}){ this.mode = "upsert"; this.val = v; this.conf = o.onConflict; return this; }
    update(v){ this.mode = "update"; this.val = v; return this; }
    delete(){ this.mode = "delete"; return this; }
    eq(k, v){ this.f.push(r => String(r[k]) === String(v)); return this; }
    neq(k, v){ this.f.push(r => String(r[k]) !== String(v)); return this; }
    in(k, v){ const s = new Set(v.map(String)); this.f.push(r => s.has(String(r[k]))); return this; }
    gt(k, v){ this.f.push(r => r[k] > v); return this; }
    gte(k, v){ this.f.push(r => r[k] >= v); return this; }
    lt(k, v){ this.f.push(r => r[k] < v); return this; }
    lte(k, v){ this.f.push(r => r[k] <= v); return this; }
    is(k, v){ this.f.push(r => (r[k] ?? null) === v); return this; }
    not(k, op, v){ if (op === "is") this.f.push(r => (r[k] ?? null) !== v); return this; }
    like(k, p){ const re = new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$"); this.f.push(r => re.test(r[k] ?? "")); return this; }
    ilike(k, p){ const re = new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i"); this.f.push(r => re.test(r[k] ?? "")); return this; }
    match(o){ for (const k in o) this.eq(k, o[k]); return this; }
    or(){ return this; } contains(){ return this; } filter(){ return this; } abortSignal(){ return this; }
    order(k, o = {}){ this.ord.push([k, o.ascending !== false]); return this; }
    limit(n){ this.lim = n; return this; }
    range(a, b){ this.rng = [a, b]; return this; }
    single(){ this.one = "single"; return this; }
    maybeSingle(){ this.one = "maybe"; return this; }
    then(ok, bad){ return READY.then(() => this.run()).then(ok, bad); }
    run(){
      const rows = T[this.t] || (T[this.t] = []);
      let hit = r => this.f.every(fn => fn(r));
      if (this.t === "log_secrets"){
        if (!session()) return { data: null, error: { code: "42501", message: "permission denied for table log_secrets" } };
        if (this.mode !== "select" && !isAdmin()) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
        if (!isAdmin()){
          const mine = new Set(T.characters.filter(c => c.owner_id === viewer).map(c => String(c.id)));
          const base = hit; hit = r => base(r) && (r.character_ids || []).some(id => mine.has(String(id)));
        }
      }
      let out = [];
      if (this.mode === "insert" || this.mode === "upsert"){
        const list = (Array.isArray(this.val) ? this.val : [this.val]).map(v => ({ ...v }));
        for (const v of list){
          const key = this.conf || "id";
          const old = this.mode === "upsert" && v[key] != null && rows.find(r => String(r[key]) === String(v[key]));
          if (old){ Object.assign(old, v); out.push(old); continue; }
          if (v.id == null) v.id = uid();
          if (v.created_at == null) v.created_at = now();
          rows.push(v); out.push(v);
        }
        persist();
      } else if (this.mode === "update"){
        out = rows.filter(hit); out.forEach(r => Object.assign(r, this.val)); persist();
      } else if (this.mode === "delete"){
        out = rows.filter(hit); T[this.t] = rows.filter(r => !hit(r)); persist();
      } else out = rows.filter(hit);
      out = out.map(r => ({ ...r }));
      for (const rel of relations(this.sel)) out.forEach(r => { if (!(rel in r)) r[rel] = []; });
      if (this.ord.length) out.sort((a, b) => { for (const [k, asc] of this.ord){ const c = cmp(a[k], b[k]); if (c) return asc ? c : -c; } return 0; });
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) out = out.slice(0, this.lim);
      const count = this.opts.count ? out.length : null;
      if (this.opts.head) return { data: null, count, error: null };
      if (this.mode !== "select" && !this.returning) return { data: null, error: null, count };
      if (this.one){
        if (!out.length) return this.one === "maybe" ? { data: null, error: null } : { data: null, error: { code: "PGRST116", message: "행이 없습니다 (테스트 사이트)" } };
        return { data: out[0], error: null };
      }
      return { data: out, error: null, count };
    }
  }

  /* ---------- 로그인 흉내: 처음엔 관리자로 로그인된 상태 ---------- */
  /* 보는 사람: 관리자 / 테스트 멤버 1·2 / 로그인 안 함 (테스트 표시줄에서 바꿈) */
  const VIEW_KEY = "logtest-viewer";
  let viewer = ADMIN.id;
  try { const v = localStorage.getItem(VIEW_KEY); if (v !== null) viewer = v; } catch (_) {}
  const who = () => T.profiles.find(p => p.id === viewer) || null;
  const isAdmin = () => who()?.role === "admin";
  const session = () => !viewer || !who() ? null : { access_token: "test", user: { id: viewer, email: who().email } };
  const listeners = [];
  const emit = ev => setTimeout(() => listeners.forEach(fn => fn(ev, session())), 0);
  const setViewer = v => { viewer = v; try { localStorage.setItem(VIEW_KEY, v); } catch (_) {} };
  window.logtestViewer = { get: () => viewer, set: v => { setViewer(v); location.reload(); }, list: () => [{ id: ADMIN.id, name: "관리자" }, ...MEMBERS.map(m => ({ id: m.id, name: m.display_name })), { id: "", name: "로그인 안 함" }] };

  const channel = () => { const c = { on(){ return c; }, subscribe(){ return c; }, send(){ return Promise.resolve("ok"); }, unsubscribe(){ return Promise.resolve("ok"); } }; return c; };
  const notHere = { data: null, error: { message: "테스트 사이트에서는 쓸 수 없는 기능입니다" } };

  function createClient(){
    return {
      from: t => new Query(t),
      rpc: async (fn, a = {}) => {
        await READY;
        if (fn === "admin_set_owner"){ const c = T.characters.find(x => String(x.id) === String(a.p_character)); if (c){ c.owner_id = a.p_owner || null; persist(); } return { data: null, error: null }; }
        if (fn === "admin_set_role"){ const p = T.profiles.find(x => x.id === a.p_user); if (p){ p.role = a.p_admin ? "admin" : "member"; persist(); } return { data: null, error: null }; }
        return { data: [], error: null };
      },
      channel, removeChannel(){}, removeAllChannels(){},
      functions: { invoke: async () => notHere },
      storage: {
        from: bucket => ({
          getPublicUrl: path => ({ data: { publicUrl: files.get(bucket + "/" + path) || "" } }),
          upload: async (path, blob, o = {}) => {
            await READY;
            const key = bucket + "/" + path;
            if (files.has(key) && !o.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
            putFile(key, blob);
            return { data: { path }, error: null };
          },
          remove: async paths => { for (const p of paths){ const k = bucket + "/" + p; if (files.has(k)){ URL.revokeObjectURL(files.get(k)); files.delete(k); blobs.delete(k); idbDel(k); } } return { data: [], error: null }; },
          download: async path => ({ data: blobs.get(bucket + "/" + path) || null, error: blobs.has(bucket + "/" + path) ? null : { message: "없음" } }),
          list: async () => ({ data: [], error: null })
        })
      },
      auth: {
        getSession: async () => ({ data: { session: session() }, error: null }),
        getUser: async () => ({ data: { user: session()?.user || null }, error: null }),
        onAuthStateChange: fn => { listeners.push(fn); fn("INITIAL_SESSION", session()); return { data: { subscription: { unsubscribe(){} } } }; },
        signInWithPassword: async () => { setViewer(ADMIN.id); emit("SIGNED_IN"); return { data: { session: session() }, error: null }; },
        signOut: async () => { setViewer(""); emit("SIGNED_OUT"); return { error: null }; },
        updateUser: async () => ({ data: {}, error: null }),
        resetPasswordForEmail: async () => ({ data: {}, error: null }),
        signUp: async () => notHere
      }
    };
  }
  window.supabase = { createClient };

  /* 링크 페이지 안에서는 브라우저 확인창이 뜨지 않고 늘 '취소'로 처리됨 → 테스트 사이트에서는 늘 '확인'으로 */
  window.confirm = () => true;

  /* 처음 상태로 되돌리기 — 테스트 표시줄 버튼, 3초 안에 두 번 누르면 실행 */
  const reset = async () => {
    try { localStorage.removeItem(TABLE_KEY); localStorage.removeItem(VIEW_KEY); } catch (_) {}
    try { await new Promise(r => { const q = indexedDB.deleteDatabase("logtest-files"); idb?.close(); q.onsuccess = q.onerror = q.onblocked = () => r(); }); } catch (_) {}
    location.hash = ""; location.reload();
  };
  /* 테스트 표시줄: 보는 사람 고르기 */
  const bar = document.getElementById("logtest-bar");
  if (bar){
    const sel = document.createElement("select");
    sel.id = "logtest-viewer"; sel.setAttribute("aria-label", "보는 사람");
    sel.style.cssText = "font:inherit;color:#000;background:#ADCFEA;border:0;padding:1px 4px";
    sel.innerHTML = window.logtestViewer.list().map(v => `<option value="${v.id}">${v.name}로 보기</option>`).join("");
    sel.value = viewer;
    sel.addEventListener("change", () => window.logtestViewer.set(sel.value));
    bar.insertBefore(sel, document.getElementById("logtest-reset"));
  }
  let armed = 0;
  document.addEventListener("click", e => {
    const b = e.target.closest("#logtest-reset");
    if (!b) return;
    if (Date.now() - armed < 3000){ b.textContent = "지우는 중…"; reset(); return; }
    armed = Date.now(); b.textContent = "한 번 더 누르면 초기화";
    setTimeout(() => { if (Date.now() - armed >= 3000) b.textContent = "처음 상태로"; }, 3100);
  });
})();
