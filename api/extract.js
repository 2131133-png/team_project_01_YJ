// 자유 입력 → 〈표 5〉 사실 항목. AI 는 값 고르기만 한다(판단은 rules.js).
// AI 가 모두 실패하면 단어 맞추기로 만든 「시연 값」을 돌려주고, 이유를 함께 보낸다.
import { FIELDS, cleanFacts, hasCrisisWord, emptyFacts } from './_lib/rules.js';
import { askAi } from './_lib/ai.js';

// 계좌번호·전화번호·주민번호 모양은 AI 에 보내기 전에 가린다
export function mask(text) {
  return String(text)
    .replace(/\d{6}-?[1-4]\d{6}/g, '[가림]')
    .replace(/01[016789][- ]?\d{3,4}[- ]?\d{4}/g, '[전화번호]')
    .replace(/\d{2,6}(-\d{2,6}){1,3}/g, '[번호]')
    .replace(/\d{10,}/g, '[번호]');
}

const SYSTEM = `너는 중고거래 피해 상담의 첫 단계에서 이용자 문장을 사실 항목으로 정리하는 도우미다.
판단·조언·위로 문장은 쓰지 않는다. 아래 항목마다 주어진 값 중 하나만 골라 JSON 객체 하나로만 답한다.
문장에 분명히 나오지 않으면 추측하지 말고 "모름"(crisis 는 "없음")을 고른다.
${Object.entries(FIELDS).map(([k, f]) => `- ${k} (${f.label}): ${f.values.map((v) => `"${v}"`).join(' | ')}`).join('\n')}
crisis 는 자해·자살을 암시하는 표현이 조금이라도 있으면 "있음"이다.
situation: 거래 상대에게 돈을 보냈는데 문제가 생겼으면 "중고거래 피해", 계좌번호·금액을 잘못 입력했으면 "착오송금", 인증번호·비밀번호를 알려 줬거나 링크·앱 설치가 있으면 "보이스피싱 등 다른 피해". 어느 쪽인지 불분명하면 "모름".
예: {"crisis":"없음","situation":"중고거래 피해","payment":"계좌이체","receipt":"못 받음","contact":"답 없음·차단","fakePost":"모름","product":"실물"}`;

function parseJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// AI 가 없을 때 쓰는 단어 맞추기(시연 값)
function demoExtract(t) {
  const f = emptyFacts();
  const has = (...w) => w.some((x) => t.includes(x));
  if (has('잘못 보내', '잘못 입력', '잘못 송금', '잘못 이체')) f.situation = '착오송금';
  else if (has('인증번호', '비밀번호', '앱 설치', '링크')) f.situation = '보이스피싱 등 다른 피해';
  else if (has('중고', '판매자', '입금', '송금', '보냈', '거래', '사기', '샀', '구매')) f.situation = '중고거래 피해';
  if (has('계좌', '입금', '이체', '송금')) f.payment = '계좌이체';
  if (has('안전결제')) f.payment = '플랫폼 안전결제';
  if (has('직거래', '만나서')) f.payment = '직거래 현장 결제';
  if (has('안 옴', '안옴', '못 받', '못받', '안 와', '안와', '안 보내')) f.receipt = '못 받음';
  if (has('배송 중', '배송중')) f.receipt = '배송 중이라고 함';
  if (has('설명과 다', '하자', '고장', '상태가')) f.receipt = '설명과 상태가 다름';
  if (has('다른 물건', '벽돌')) f.receipt = '전혀 다른 물건이 옴';
  if (has('파손', '깨져', '부서')) f.receipt = '배송 중 파손';
  if (has('이미 사용', '사용된', '번호가 없')) f.receipt = '쿠폰·번호가 이미 사용됨·없음';
  if (has('차단', '답이 없', '답 없', '연락 안', '연락이 안', '잠수', '읽씹')) f.contact = '답 없음·차단';
  if (has('글도 지워', '글이 지워', '글 삭제', '계정', '탈퇴', '글도 없')) f.contact = '판매 글·계정 사라짐';
  if (has('연락은 돼', '연락됨', '답장은')) f.contact = '연락됨';
  if (has('남의 사진', '도용')) f.fakePost = '남의 사진이었음';
  if (has('피해 글', '다른 피해자')) f.fakePost = '다른 피해 글을 봄';
  if (has('기프티콘', '쿠폰', '상품권', '티켓')) f.product = '비실물(쿠폰·상품권·티켓)';
  return f;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 만 받아요' });
  const text = String(req.body?.text || '').slice(0, 1000);
  if (!text.trim()) return res.status(400).json({ error: '내용이 비어 있어요' });

  const crisisWord = hasCrisisWord(text);
  const ai = await askAi(SYSTEM, mask(text));
  const parsed = ai.text ? parseJson(ai.text) : null;
  if (ai.text && !parsed) ai.tried[ai.tried.length - 1] = { name: ai.provider, ok: false, reason: '형식 오류(JSON 아님)' };

  const live = Boolean(parsed);
  const facts = live ? cleanFacts(parsed) : demoExtract(text);
  if (crisisWord) facts.crisis = '있음'; // 단어 목록과 AI 중 하나라도 걸리면 있음

  // 어느 AI가 답했는지 서버 기록에 남긴다(문장 내용은 남기지 않음)
  const fails = ai.tried.filter((t) => !t.ok).map((t) => `${t.name}: ${t.reason}`).join(', ');
  console.log(`[extract] ${live ? `${ai.provider} 성공 (${ai.model})` : '시연 값'}${fails ? ` — 실패: ${fails}` : ''}`);

  res.status(200).json({
    facts,
    mode: live ? 'live' : 'demo',
    provider: live ? ai.provider : null,
    model: live ? ai.model : null,
    tried: ai.tried,
    crisisWord,
  });
}
