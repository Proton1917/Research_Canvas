import fs from 'node:fs';
import * as Y from 'yjs';

const { canvas, object_id, bounds } = JSON.parse(fs.readFileSync(0, 'utf8'));
const doc = new Y.Doc();
Y.applyUpdate(doc, Buffer.from(canvas.editor_state.update, 'base64'));
doc.transact(() => {
  doc.getMap('blocks').get(object_id).set('prop:xywh', JSON.stringify(bounds));
});
canvas.editor_state.update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
process.stdout.write(JSON.stringify(canvas));
