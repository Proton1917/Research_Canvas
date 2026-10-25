import fs from 'node:fs';
import * as Y from 'yjs';

const canvas = JSON.parse(fs.readFileSync(0, 'utf8'));
const doc = new Y.Doc();
Y.applyUpdate(doc, Buffer.from(canvas.editor_state.update, 'base64'));
process.stdout.write(JSON.stringify(doc.getMap('blocks').toJSON()));
