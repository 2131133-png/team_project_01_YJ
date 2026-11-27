// 화면의 첫 인사를 docs/페르소나.md 에서 읽어 돌려준다. 문서를 못 읽으면 greeting 이 null — 화면이 기본 문구를 쓴다.
import { loadPersona } from './_lib/persona.js';

export default function handler(req, res) {
  const p = loadPersona();
  res.status(200).json({ name: p?.name || null, greeting: p?.greeting || null });
}
