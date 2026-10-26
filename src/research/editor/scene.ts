// 画布场景投影：从编辑器模型和研究对象生成 AI 可读取的结构化场景。
//
// 投影只读取编辑器状态，不修改画布。对象保留编辑器实例标识与研究对象引用；
// 几何信息使用画布世界坐标，视口缩放与平移单独记录，因此缩放或平移不改变对象坐标。
import type { BlockModel, Store } from '@editor/document';

import type { Anchor, FragmentCard, LinkView, Relation, ResearchContext, ResearchDocument } from '../api/types';
import { blockText, isProjectedBlock } from './projection';

export type SceneObjectKind =
  | 'document' | 'fragment' | 'idea' | 'discussion' | 'link' | 'group' | 'frame' | 'drawing' | 'image';

export type SceneLayout = { x: number; y: number; width: number; height: number; rotate: number };

export type SceneRef =
  | { type: 'document'; document_id: string; version: number; kind: ResearchDocument['kind'] }
  | { type: 'anchor'; anchor_id: string; document_id: string; version: number; block_id: string; start_utf16: number; page: number | null }
  | { type: 'relation'; relation_id: string }
  | { type: 'editor'; flavour: string };

export type SceneObject = {
  instance_id: string;
  kind: SceneObjectKind;
  /** 编辑器块 flavour 或画布元素类型 */
  flavour: string;
  ref: SceneRef;
  title: string;
  /** 可读正文；整篇文稿默认只给出标题与版本，正文由用户另行选择 */
  text: string;
  formulas: string[];
  layout: SceneLayout | null;
  /** 所属分组或框（由内到外） */
  parent_ids: string[];
  child_ids: string[];
  /** 通过选择分组或框间接纳入 */
  via: string | null;
  link?: {
    view: LinkView | null;
    relation: Relation | null;
    label: string;
    source_instance: string | null;
    target_instance: string | null;
    source_point: [number, number] | null;
    target_point: [number, number] | null;
  };
  discussion?: { question: string; context_id: string | null; sources: ResearchContext['sources'] | null };
  /** 无法读取文字时的说明（笔迹、图片等） */
  unreadable?: string;
  /** 图片对象对应的工作区资产，可作为视觉输入 */
  asset_id?: string | null;
};

export type SceneProjection = {
  workspace_id: string;
  canvas_id: string;
  canvas_revision: number;
  entry: 'selection' | 'group' | 'canvas';
  viewport: { zoom: number; center_x: number; center_y: number };
  objects: SceneObject[];
  bounds: SceneLayout | null;
  created_at: string;
};

/** 投影读取研究对象时使用的目录。 */
export type SceneCatalog = {
  workspaceId: string;
  canvasId: string;
  canvasRevision: number;
  documents: Map<string, ResearchDocument>;
  anchors: Map<string, Anchor>;
  relations: Map<string, Relation>;
  contexts: Record<string, ResearchContext>;
  /** 已载入文稿的会话内版本号（可能高于目录中的版本） */
  documentVersion(id: string): number | null;
  linkView(connectorId: string): LinkView | null;
  fragment(blockId: string): FragmentCard | null;
  /** 编辑器图片块的资源键 → 工作区资产 */
  assetFor(blobKey: string): string | null;
};

type ElementLike = {
  id: string;
  type: string;
  xywh: string;
  rotate?: number;
  text?: { toString(): string };
  title?: { toString(): string };
  childIds?: string[];
  source?: { id?: string; position?: [number, number] };
  target?: { id?: string; position?: [number, number] };
  absolutePath?: ArrayLike<number>[];
};

type SurfaceModel = {
  getElementById(id: string): ElementLike | null;
  getGroups(id: string): Array<{ id: string }>;
  elementModels?: ElementLike[];
};

const SYNCED_DOC = 'affine:embed-synced-doc';
const BLOCK_KINDS = new Set([SYNCED_DOC, 'affine:note', 'affine:edgeless-text', 'affine:frame', 'affine:image']);

function parseXYWH(value: string | undefined): [number, number, number, number] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as number[];
    if (parsed.length === 4 && parsed.every(Number.isFinite)) return parsed as [number, number, number, number];
  } catch {
    /* 非法布局值不提供几何信息 */
  }
  return null;
}

function layoutOf(xywh: string | undefined, rotate = 0): SceneLayout | null {
  const parsed = parseXYWH(xywh);
  if (!parsed) return null;
  const [x, y, width, height] = parsed;
  return { x: round(x), y: round(y), width: round(width), height: round(height), rotate: round(rotate) };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** 文本中的公式：块级 $$…$$ 与行内 $…$。 */
export function extractFormulas(text: string): string[] {
  const formulas: string[] = [];
  for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$/g)) formulas.push(match[1].trim());
  const inline = text.replace(/\$\$[\s\S]+?\$\$/g, ' ');
  for (const match of inline.matchAll(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g)) formulas.push(match[1].trim());
  return formulas;
}

function childrenText(model: BlockModel): string {
  const parts: string[] = [];
  const visit = (child: BlockModel) => {
    if (isProjectedBlock(child)) parts.push(blockText(child));
    child.children.forEach(visit);
  };
  model.children.forEach(visit);
  return parts.filter(part => part.trim()).join('\n\n');
}

function surfaceOf(store: Store): SurfaceModel | null {
  return (store.getModelsByFlavour('affine:surface')[0] as unknown as SurfaceModel | undefined) ?? null;
}

/** 画布中全部可投影对象的实例标识（块与元素）。 */
export function allSceneIds(store: Store): string[] {
  const ids: string[] = [];
  for (const model of store.getModelsByFlavour(Array.from(BLOCK_KINDS))) {
    if (model.flavour === 'affine:note' && (model.props as { displayMode?: string }).displayMode === 'doc') continue;
    ids.push(model.id);
  }
  const surface = surfaceOf(store);
  for (const element of surface?.elementModels ?? []) ids.push(element.id);
  return ids;
}

/**
 * 生成场景投影。selected 为画布当前选择；分组与框会展开其子对象，
 * 连线两端对象以端点引用出现，正文是否提交由材料选择决定。
 */
export function projectScene(
  store: Store,
  selected: string[],
  catalog: SceneCatalog,
  viewport: { zoom: number; centerX: number; centerY: number },
  entry: SceneProjection['entry'] = 'selection',
): SceneProjection {
  const surface = surfaceOf(store);
  const frames = store.getModelsByFlavour('affine:frame');
  const frameOf = (id: string) => frames.filter(frame => ((frame.props as { childElementIds?: Record<string, boolean> }).childElementIds ?? {})[id]).map(frame => frame.id);
  const parentsOf = (id: string) => [...(surface?.getGroups(id).map(group => group.id) ?? []), ...frameOf(id)];
  const objects = new Map<string, SceneObject>();

  const describe = (id: string, via: string | null): SceneObject | null => {
    const block = store.getModelById(id);
    if (block && BLOCK_KINDS.has(block.flavour)) return describeBlock(block, via);
    const element = surface?.getElementById(id);
    if (element) return describeElement(element, via);
    return null;
  };

  const describeBlock = (model: BlockModel, via: string | null): SceneObject => {
    const props = model.props as unknown as { xywh?: string; pageId?: string; title?: { toString(): string }; childElementIds?: Record<string, boolean>; caption?: string; rotate?: number; sourceId?: string };
    const base = { instance_id: model.id, flavour: model.flavour, layout: layoutOf(props.xywh, props.rotate ?? 0), parent_ids: parentsOf(model.id), child_ids: [] as string[], via, formulas: [] as string[] };
    if (model.flavour === SYNCED_DOC && props.pageId) {
      const doc = catalog.documents.get(props.pageId);
      const version = catalog.documentVersion(props.pageId) ?? doc?.current_version ?? 0;
      const ref: SceneRef = { type: 'document', document_id: props.pageId, version, kind: doc?.kind ?? 'document' };
      if (doc?.kind === 'discussion') {
        const contextId = typeof doc.metadata.context_id === 'string' ? doc.metadata.context_id : null;
        const answer = doc.content.blocks.map(item => item.text).join('\n\n');
        return {
          ...base, kind: 'discussion', ref, title: doc.metadata.question ?? doc.title, text: answer, formulas: extractFormulas(answer),
          discussion: { question: doc.metadata.question ?? doc.title, context_id: contextId, sources: contextId ? catalog.contexts[contextId]?.sources ?? null : null },
        };
      }
      if (doc?.kind === 'note') {
        const text = doc.content.blocks.map(item => item.text).join('\n\n');
        return { ...base, kind: 'idea', ref, title: doc.title || '想法', text, formulas: extractFormulas(text) };
      }
      if (doc?.kind === 'image') {
        const asset = typeof doc.metadata.source_asset_id === 'string' ? doc.metadata.source_asset_id : null;
        return { ...base, kind: 'image', ref, title: doc.title, text: '', asset_id: asset, unreadable: '未选择图像阅读时，模型只收到标题、来源与位置' };
      }
      return { ...base, kind: 'document', ref, title: doc?.title ?? '文稿', text: '' };
    }
    if (model.flavour === 'affine:note') {
      const fragment = catalog.fragment(model.id);
      const anchor = fragment ? catalog.anchors.get(fragment.anchor_id) : undefined;
      if (fragment && anchor) {
        const doc = catalog.documents.get(anchor.document_id);
        return {
          ...base, kind: 'fragment', title: doc?.title ?? '文稿', text: anchor.quote, formulas: extractFormulas(anchor.quote),
          ref: { type: 'anchor', anchor_id: anchor.id, document_id: anchor.document_id, version: anchor.version, block_id: anchor.block_id, start_utf16: anchor.start_utf16, page: anchor.page },
        };
      }
      const text = childrenText(model);
      return { ...base, kind: 'idea', ref: { type: 'editor', flavour: model.flavour }, title: '便笺', text, formulas: extractFormulas(text) };
    }
    if (model.flavour === 'affine:edgeless-text') {
      const text = childrenText(model);
      return { ...base, kind: 'idea', ref: { type: 'editor', flavour: model.flavour }, title: '文字', text, formulas: extractFormulas(text) };
    }
    if (model.flavour === 'affine:frame') {
      const children = Object.keys(props.childElementIds ?? {});
      return { ...base, kind: 'frame', ref: { type: 'editor', flavour: model.flavour }, title: props.title?.toString() || '框', text: '', child_ids: children };
    }
    return {
      ...base, kind: 'image', ref: { type: 'editor', flavour: model.flavour }, title: props.caption || '图片', text: '',
      asset_id: props.sourceId ? catalog.assetFor(props.sourceId) : null, unreadable: '未选择图像阅读时，模型只收到标题与位置',
    };
  };

  const describeElement = (element: ElementLike, via: string | null): SceneObject => {
    const base = { instance_id: element.id, flavour: element.type, layout: layoutOf(element.xywh, element.rotate ?? 0), parent_ids: parentsOf(element.id), child_ids: [] as string[], via, formulas: [] as string[] };
    const ref: SceneRef = { type: 'editor', flavour: element.type };
    if (element.type === 'connector') {
      const view = catalog.linkView(element.id);
      const relation = view?.relation_id ? catalog.relations.get(view.relation_id) ?? null : null;
      const label = element.text?.toString() ?? '';
      const path = element.absolutePath ?? [];
      const point = (value: ArrayLike<number>): [number, number] => [round(value[0]), round(value[1])];
      return {
        ...base, kind: 'link', title: relation ? relation.kind : '视觉连线',
        ref: relation ? { type: 'relation', relation_id: relation.id } : ref,
        text: [label, relation?.label].filter(Boolean).join('\n'),
        link: {
          view, relation, label,
          source_instance: element.source?.id ?? null,
          target_instance: element.target?.id ?? null,
          source_point: path.length ? point(path[0]) : element.source?.position ? [round(element.source.position[0]), round(element.source.position[1])] : null,
          target_point: path.length ? point(path[path.length - 1]) : element.target?.position ? [round(element.target.position[0]), round(element.target.position[1])] : null,
        },
      };
    }
    if (element.type === 'group') {
      return { ...base, kind: 'group', ref, title: element.title?.toString() || '分组', text: '', child_ids: element.childIds ?? [] };
    }
    if (element.type === 'shape' || element.type === 'text') {
      const text = element.text?.toString() ?? '';
      return { ...base, kind: 'idea', ref, title: element.type === 'shape' ? '形状' : '文字', text, formulas: extractFormulas(text) };
    }
    return { ...base, kind: 'drawing', ref, title: element.type === 'brush' ? '笔迹' : element.type, text: '', unreadable: '笔迹或图形没有可读取的文字，模型只收到位置和类型' };
  };

  const add = (id: string, via: string | null) => {
    if (objects.has(id)) return;
    const object = describe(id, via);
    if (!object) return;
    objects.set(id, object);
    // 分组与框展开子对象
    for (const child of object.child_ids) add(child, via ?? id);
  };
  for (const id of selected) add(id, null);

  const list = Array.from(objects.values());
  const rects = list.filter(object => object.kind !== 'link' && object.layout).map(object => object.layout!);
  const bounds = rects.length ? (() => {
    const x = Math.min(...rects.map(rect => rect.x));
    const y = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    return { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y), rotate: 0 };
  })() : null;

  return {
    workspace_id: catalog.workspaceId,
    canvas_id: catalog.canvasId,
    canvas_revision: catalog.canvasRevision,
    entry,
    viewport: { zoom: round(viewport.zoom), center_x: round(viewport.centerX), center_y: round(viewport.centerY) },
    objects: list,
    bounds,
    created_at: new Date().toISOString(),
  };
}

/** 与所选对象外接矩形相距 gap 以内的其他对象（连线除外），供用户选择加入。 */
export function neighborIds(store: Store, selected: string[], gap = 240): string[] {
  const surface = surfaceOf(store);
  const boundsOf = (id: string) => {
    const block = store.getModelById(id);
    const xywh = block ? (block.props as { xywh?: string }).xywh : surface?.getElementById(id)?.xywh;
    return parseXYWH(xywh);
  };
  const rects = selected.map(boundsOf).filter((rect): rect is [number, number, number, number] => !!rect);
  if (rects.length === 0) return [];
  const left = Math.min(...rects.map(rect => rect[0])) - gap;
  const top = Math.min(...rects.map(rect => rect[1])) - gap;
  const right = Math.max(...rects.map(rect => rect[0] + rect[2])) + gap;
  const bottom = Math.max(...rects.map(rect => rect[1] + rect[3])) + gap;
  const chosen = new Set(selected);
  return allSceneIds(store).filter(id => {
    if (chosen.has(id) || surface?.getElementById(id)?.type === 'connector') return false;
    const rect = boundsOf(id);
    return !!rect && rect[0] < right && rect[0] + rect[2] > left && rect[1] < bottom && rect[1] + rect[3] > top;
  });
}

/** 在选区下方给出默认写入区域，宽度与选区一致。 */
export function regionBelow(bounds: SceneLayout | null, gap = 120, height = 420): SceneLayout | null {
  if (!bounds) return null;
  return { x: bounds.x, y: round(bounds.y + bounds.height + gap), width: Math.min(Math.max(bounds.width, 560), 1200), height, rotate: 0 };
}
