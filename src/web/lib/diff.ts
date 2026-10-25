export type DiffPart = { type: 'same' | 'del' | 'ins'; text: string };

function tokenize(text: string) {
  // 中文按字、拉丁文按词与空白切分，差异结果便于阅读。
  return text.match(/[\p{Script=Han}]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_\p{Script=Han}]/gu) ?? [];
}

/** 基于最长公共子序列的分词差异；超长文本退化为整段替换。 */
export function diffText(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > 4_000_000) return [{ type: 'del', text: before }, { type: 'ins', text: after }];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) { push('del', a[i]); i++; }
    else { push('ins', b[j]); j++; }
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('ins', b[j++]);
  return parts;
}
