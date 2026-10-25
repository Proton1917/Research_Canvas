import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

const path = new URL('../.runtime/latex-acceptance.json', import.meta.url);
const record = JSON.parse(await readFile(path, 'utf8'));
const original = JSON.parse(record.fresh_raw_response);
const processor = unified().use(remarkParse).use(remarkMath);
function codeValues(text) {
  const values = [];
  visit(processor.parse(text), node => {
    if (node.type === 'code' || node.type === 'inlineCode') values.push({ type: node.type, value: node.value });
  });
  return values;
}
const actions = record.fresh_proposal.actions.filter(action => action.type === 'create_document');
for (const action of actions) {
  const before = original.create_documents.find(document => document.key === action.key);
  const expected = codeValues(before.text);
  assert.ok(expected.length > 0);
  assert.deepEqual(codeValues(action.text), expected);
}
record.code_literals = 'passed';
await writeFile(path, JSON.stringify(record, null, 2) + '\n');
process.stdout.write('code_literals: passed\n');
