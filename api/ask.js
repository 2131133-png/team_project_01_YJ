// 결과가 나온 뒤 이용자의 궁금한 점에 답한다.
// AI 는 이미 나온 진단·안내 문구(guides.js) 안에서만 설명하고, 판단(분류)은 바꾸지 않는다.
// 시스템 프롬프트 순서: 「AI 답변 규칙」 → 페르소나(docs/페르소나.md) → 안내 자료. 페르소나를 못 읽으면 규칙만으로 답한다.
// AI 가 모두 실패하면 같은 안내 문구를 그대로 돌려준다.
import { classify, hasCrisisWord } from './_lib/rules.js';
import { guideFor, CENTER, CRISIS_GUIDE } from './_lib/guides.js';
import { askAi } from './_lib/ai.js';
import { personaPrompt } from './_lib/persona.js';
import { resultKey, faqById, matchFaq, faqReply, faqList, intentOf, fixedReply, eventPrefix, NOT_FOUND, NOT_FOUND_LINKS, RELATED_LABEL } from './_lib/faq.js';
import { mask } from './extract.js';

// 「AI 답변 규칙」 — 페르소나보다 앞에 두고, 페르소나가 바꿀 수 없다
const RULES = `너는 중고거래 피해 안내 챗봇이다. 이용자는 이미 진단 결과와 증거 정리표를 받았고, 그 뒤에 궁금한 점을 묻는다.
[AI 답변 규칙 — 무엇보다 우선한다]
- 아래 [안내 자료] 안의 내용으로만 답한다. 자료에 없는 법 조문·기한·금액·성공 가능성은 지어내지 않는다.
- 자료로 답할 수 없으면 모른다고 말하고 ${CENTER.name} ☎${CENTER.tel}(${CENTER.hours})을 안내한다.
- 「자료에 없다」「안내 자료」「제가 가진 정보」 같은 말은 쓰지 않는다. 이용자는 자료가 있다는 것을 모른다. 대신 「그 부분은 제가 정확히 알려 드리기 어려워요. 365센터에 물어보시면 정확히 알 수 있어요」처럼 자연스럽게 말한다.
- 모르는 부분만 그렇게 말하고, 아는 부분은 먼저 충분히 답한다.
- 사기 여부·승소·환불 가능 여부·처벌 수위 같은 판정이나 처분은 단정하지 않는다. 판단은 수사기관·조정 기관이 한다고 말한다.
- 돈, 계좌 비밀번호, 인증번호, 주민등록번호를 묻거나 요구하지 않는다. 대신 접수하지도 않는다.
- 쉬운 말로 짧게 답한다(5문장 이내). 해야 할 일은 순서가 보이게 쓴다.
- 답 본문(answer)에는 문서 이름이나 출처를 쓰지 않는다. 이용자에게는 근거를 보여 주지 않는다.
- 답에 쓴 내용의 근거 문서 이름을 [근거 문서] 목록에서만 골라 sources 에 담는다. 목록에 없는 이름은 쓰지 않고, 근거로 삼은 문서가 없으면 빈 배열로 둔다.
- 반드시 JSON 객체 하나로만 답한다: {"answer":"...","sources":["문서이름"]}`;

function material(c, g, facts) {
  return [
    `진단: ${g.label} (이유: ${c.ruleText || '규칙표 기준'})`,
    `이용자가 정리한 사실: ${Object.entries(facts).filter(([k]) => k !== 'crisis').map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `지금 할 일:\n${g.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `갈 곳: ${g.orgs.map((o) => `${o.name}(${o.how})`).join(' / ')}`,
    `증거 정리표 5번 체크리스트: ${g.checklist.join(' / ')}`,
    g.nonPhysical ? `쿠폰·상품권 안내: ${g.nonPhysical}` : '',
    g.laws?.length ? `관련 법령: ${g.laws.map((l) => `${l.name} 제${l.jo.no}조${l.jo.branch ? `의${l.jo.branch}` : ''} — ${l.why}`).join(' / ')}` : '',
    `[근거 문서] ${g.sources.join(', ')}`,
  ].filter(Boolean).join('\n');
}

function parseAnswer(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (typeof j.answer !== 'string' || !j.answer.trim()) return null;
    return { answer: j.answer.trim(), sources: Array.isArray(j.sources) ? j.sources.filter((s) => typeof s === 'string') : [] };
  } catch { return null; }
}

// 흐름: 위기 표현 → (결과 전) 인사·감사·감정 고정 문구 → (결과 뒤) 자주 묻는 질문 → 감사·감정·인사 고정 문구 → AI → 못 답하면 상담 창구 안내
// 근거 문서 이름·출처는 소비자에게 보이지 않는다.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 만 받아요' });
  const stage = req.body?.stage === 'pre' ? 'pre' : 'post';
  const faqId = Number(req.body?.faqId) || null;
  const question = String(req.body?.question || '').slice(0, 500);
  if (!question.trim() && !faqId) return res.status(400).json({ error: '내용이 비어 있어요' });

  const facts = req.body?.facts || {};
  const c = classify(facts);
  const g = guideFor(c);
  const key = resultKey(c);
  const crisisWord = hasCrisisWord(question);

  // 위기 표현이 있으면 피해 안내보다 109 안내가 먼저다(페르소나 「하지 않는 일」·화면의 위기 상자와 같은 원칙)
  if (crisisWord) {
    return res.status(200).json({
      answer: `${CRISIS_GUIDE.title}.\n${CRISIS_GUIDE.body}`,
      mode: 'crisis', crisisWord,
    });
  }

  // 결과 버튼으로 고른 질문은 말뜻을 가를 필요 없이 그 질문의 답을 준다
  if (faqId && faqById(faqId)) return res.status(200).json({ ...faqReply(faqById(faqId), key), relatedLabel: RELATED_LABEL, mode: 'faq', crisisWord });

  const intent = intentOf(question);

  // 결과 전: 인사·감사·감정만 고정 문구로 받고, 그 밖의 글은 사건 설명으로 보고 화면이 이어서 정리한다
  if (stage === 'pre') {
    if (intent.kind === 'event') return res.status(200).json({ kind: 'event', prefix: intent.emotion ? eventPrefix() : null });
    const fixed = fixedReply(intent);
    if (fixed) return res.status(200).json({ ...fixed, mode: 'fixed', crisisWord });
    return res.status(200).json({ kind: 'event', prefix: null });
  }

  // 결과 뒤: 자주 묻는 질문에 맞으면 그 답
  const f = matchFaq(question, key);
  if (f) return res.status(200).json({ ...faqReply(f, key), relatedLabel: RELATED_LABEL, mode: 'faq', crisisWord });

  // 감사·감정·인사는 고정 문구
  const fixed = fixedReply(intent);
  if (fixed) return res.status(200).json({ ...fixed, related: faqList(key).slice(0, 4), relatedLabel: RELATED_LABEL, mode: 'fixed', crisisWord });

  const system = `${RULES}${personaPrompt()}\n\n[안내 자료]\n${material(c, g, facts)}`;
  const ai = await askAi(system, mask(question));
  const parsed = ai.text ? parseAnswer(ai.text) : null;
  console.log(`[ask] ${parsed ? `${ai.provider} 성공` : '상담 창구 안내로 대체'}`);

  if (parsed) return res.status(200).json({ answer: parsed.answer, links: [], related: faqList(key).slice(0, 4), relatedLabel: RELATED_LABEL, mode: 'live', crisisWord });
  // AI 를 쓸 수 없을 때: 정확히 모른다고 말하고 상담 창구와 자주 묻는 질문을 보여 준다
  res.status(200).json({ answer: NOT_FOUND, links: NOT_FOUND_LINKS, related: faqList(key).slice(0, 4), relatedLabel: RELATED_LABEL, mode: 'demo', crisisWord });
}
