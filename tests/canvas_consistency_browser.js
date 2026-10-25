async ({ op, record }) => {
  const model = await import('/src/web/app/model.ts');
  const { api } = await import('/src/research/api/client.ts');
  if (model.getSession()?.workspaceId !== record.workspace_id) await model.openWorkspace(record.workspace_id);
  model.openCanvas(record.canvas_id);
  const summary = await api.getWorkspace(record.workspace_id);
  const session = model.getSession();
  const canvas = await api.getCanvas(record.canvas_id);
  const documents = new Map(summary.documents.map(document => [document.id, document]));
  const entry = await session.ensureCanvas(canvas, documents);
  if (op === 'prepare') {
    const { Text } = await import('/src/editor/document/index.ts');
    const card = canvas.objects.find(object => object.document_id === record.document_id)?.id ?? await session.addDocumentToCanvas(canvas.id, documents.get(record.document_id), { x: 0, y: 0 });
    let note = entry.store.getModelsByFlavour('affine:note')[0]?.id;
    if (!note) {
      note = entry.store.addBlock('affine:note', { xywh: '[650,0,420,240]', displayMode: 'edgeless' }, entry.store.root.id);
      entry.store.addBlock('affine:paragraph', { text: new Text(record.quote), type: 'text' }, note);
    }
    session.addSourceLinks(canvas.id, [card], note);
    await session.flushCanvas(canvas.id);
    if (session.canvasStatus(canvas.id).state !== 'saved') throw new Error(JSON.stringify(session.canvasStatus(canvas.id)));
    return { card_id: card, note_id: note };
  }
  await session.holdCanvas(canvas.id);
  const raw = session.workspace.getResearchDoc(canvas.id).spaceDoc.getMap('blocks').toJSON();
  return { version: session.canvasStatus(canvas.id).version, objects: session.canvasObjects(canvas.id), blocks: raw };
}
