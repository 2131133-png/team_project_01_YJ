// docs/페르소나.md 를 읽어 챗봇 페르소나(이름·말투·역할·하는 일·하지 않는 일·첫 인사·모를 때의 답)를 돌려준다.
// 문서가 없거나 읽지 못하면 null — 그때는 페르소나 없이 「AI 답변 규칙」만으로 답한다.
// 페르소나를 바꿀 때는 docs/페르소나.md 만 고친다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [
  fileURLToPath(new URL('../../docs/페르소나.md', import.meta.url)),
  join(process.cwd(), 'docs', '페르소나.md'),
];
const PROMPT_KEYS = ['이름', '말투', '역할', '하는 일', '하지 않는 일', '모를 때의 답'];
const REQUIRED = ['이름', '말투', '역할', '첫 인사'];

let cached = null;

function parse(md) {
  const sections = {};
  const parts = String(md).split(/^## +(.+?)\s*$/m); // [머리글, 제목1, 본문1, 제목2, 본문2 …]
  for (let i = 1; i < parts.length; i += 2) sections[parts[i].trim()] = (parts[i + 1] || '').trim();
  return sections;
}

export function loadPersona() {
  if (cached) return cached;
  for (const path of CANDIDATES) {
    try {
      const sections = parse(readFileSync(path, 'utf8'));
      if (REQUIRED.some((k) => !sections[k])) continue; // 항목이 빠진 문서는 쓰지 않는다
      const greeting = sections['첫 인사'].split('\n').map((l) => l.replace(/^>\s?/, '').trim()).filter(Boolean).join(' ');
      cached = { sections, greeting, name: sections['이름'].split('\n')[0].trim() };
      return cached;
    } catch { /* 다음 후보 */ }
  }
  return null; // 못 읽으면 호출한 쪽이 페르소나 없이 규칙만으로 처리한다
}

// 시스템 프롬프트 뒤에 붙일 글(규칙보다 뒤, 규칙이 우선한다고 못 박는다)
export function personaPrompt() {
  const p = loadPersona();
  if (!p) return '';
  const body = PROMPT_KEYS.filter((k) => p.sections[k]).map((k) => `■ ${k}\n${p.sections[k]}`).join('\n\n');
  return `\n\n[페르소나] 아래는 말투와 역할을 정하는 것이다. 위의 규칙과 부딪히면 언제나 위의 규칙이 우선한다.\n${body}`;
}
