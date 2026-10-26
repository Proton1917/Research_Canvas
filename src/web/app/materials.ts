// 画布场景 → 材料清单。区分将提交的正文、历史来源、图像与仅供定位的信息。
// 默认只读取明确选中的对象；随分组或框纳入的对象、整篇正文与图像由用户选择加入。
import type { Anchor, ContextSource, ResearchContext, ResearchDocument } from '@research';
import type { SceneObject, SceneProjection } from '@research/editor';

export type MaterialGroup = 'body' | 'history' | 'visual' | 'locate';

export type Material = {
  key: string;
  group: MaterialGroup;
  objectId: string;
  label: string;
  detail: string;
  version: number | null;
  /** 默认是否选入 */
  include: boolean;
  /** 内容引用：片段按锚点、整篇按文稿读取（场景接口字段名） */
  legacy: { anchor_id: string } | { document_id: string } | null;
  /** 视觉材料对应的工作区图像资产 */
  asset_id?: string;
};

/** 期望进入上下文的材料身份：对象类型、内容标识、版本与片段共同确定。 */
export type ExpectedSource = { document_id: string; version: number | null; anchor_id: string | null; origin: string };

export function sourceKey(source: { document_id: string; version: number | null; anchor_id: string | null }) {
  return source.anchor_id ? `anchor:${source.anchor_id}` : `doc:${source.document_id}@${source.version ?? '*'}`;
}

export function buildMaterials(projection: SceneProjection, anchors: Anchor[], documents: Map<string, ResearchDocument>): Material[] {
  const result: Material[] = [];
  const seen = new Set<string>();
  const push = (material: Material) => {
    if (seen.has(material.key)) return;
    seen.add(material.key);
    result.push(material);
  };
  const position = (object: SceneObject) => object.layout ? `(${Math.round(object.layout.x)}, ${Math.round(object.layout.y)}) ${Math.round(object.layout.width)}×${Math.round(object.layout.height)}` : '无几何信息';

  for (const object of projection.objects) {
    const via = object.via ? '（随分组或框纳入）' : '';
    // 明确选中的对象默认读取；随分组或框纳入的对象由用户勾选
    const direct = !object.via;
    switch (object.kind) {
      case 'fragment': {
        if (object.ref.type !== 'anchor') break;
        const doc = documents.get(object.ref.document_id);
        push({
          key: `anchor:${object.ref.anchor_id}`, group: 'body', objectId: object.instance_id, label: `片段「${object.text.slice(0, 60)}」`,
          detail: `${doc?.title ?? '文稿'} · 版本 ${object.ref.version}${object.ref.page != null ? ` · 第 ${object.ref.page} 页` : ''}${via}`,
          version: object.ref.version, include: direct, legacy: { anchor_id: object.ref.anchor_id },
        });
        break;
      }
      case 'idea': {
        if (object.ref.type === 'document') {
          push({
            key: `doc:${object.ref.document_id}`, group: 'body', objectId: object.instance_id, label: `想法「${object.text.slice(0, 60) || object.title}」`,
            detail: `想法文稿 · 版本 ${object.ref.version}${via}`, version: object.ref.version, include: direct, legacy: { document_id: object.ref.document_id },
          });
        } else {
          push({
            key: `idea:${object.instance_id}`, group: 'body', objectId: object.instance_id, label: `${object.title}「${object.text.slice(0, 60) || '空白'}」`,
            detail: `画布对象 ${object.flavour}${via}`, version: null, include: direct && !!object.text.trim(), legacy: null,
          });
        }
        break;
      }
      case 'document': {
        if (object.ref.type !== 'document') break;
        const documentId = object.ref.document_id;
        push({
          key: `locate:${object.instance_id}`, group: 'locate', objectId: object.instance_id,
          label: `${object.ref.kind === 'pdf' ? 'PDF' : '文稿'}卡片「${object.title}」`,
          detail: `版本 ${object.ref.version} · ${position(object)}${via}`, version: object.ref.version, include: direct, legacy: null,
        });
        // 默认只提供身份与定位；整篇正文由用户另行选择，PDF 按选段或显式全文展开
        push({
          key: `doc:${documentId}`, group: 'body', objectId: object.instance_id, label: `整篇「${object.title}」`,
          detail: `版本 ${object.ref.version}（整篇阅读${object.ref.kind === 'pdf' ? '，含全部页面' : ''}）`, version: object.ref.version, include: false, legacy: { document_id: documentId },
        });
        for (const anchor of anchors.filter(item => item.document_id === documentId)) {
          push({
            key: `anchor:${anchor.id}`, group: 'body', objectId: object.instance_id, label: `片段「${anchor.quote.slice(0, 60)}」`,
            detail: `${object.title} · 版本 ${anchor.version}${anchor.page != null ? ` · 第 ${anchor.page} 页` : ''} · 可选片段`,
            version: anchor.version, include: false, legacy: { anchor_id: anchor.id },
          });
        }
        break;
      }
      case 'discussion': {
        if (object.ref.type !== 'document') break;
        push({
          key: `doc:${object.ref.document_id}`, group: 'body', objectId: object.instance_id, label: `讨论「${object.title.slice(0, 60)}」`,
          detail: `问答 · 版本 ${object.ref.version}${via}`, version: object.ref.version, include: direct, legacy: { document_id: object.ref.document_id },
        });
        const sources = object.discussion?.sources;
        if (!object.discussion?.context_id) {
          push({ key: `missing:${object.instance_id}`, group: 'history', objectId: object.instance_id, label: '历史材料缺失', detail: '该讨论没有记录 context_id，请补选原材料', version: null, include: false, legacy: null });
        } else if (!sources) {
          push({ key: `pending:${object.instance_id}`, group: 'history', objectId: object.instance_id, label: '历史材料读取中', detail: `上下文 ${object.discussion.context_id}`, version: null, include: false, legacy: null });
        } else {
          for (const source of sources) {
            push({
              key: source.anchor_id ? `hist-anchor:${source.anchor_id}` : `hist-doc:${source.document_id}@${source.version}`,
              group: 'history', objectId: object.instance_id,
              label: source.anchor_id ? `原片段「${source.content.slice(0, 60)}」` : `原整篇「${source.title}」`,
              detail: `${source.title} · 版本 ${source.version} · 来自讨论「${object.title.slice(0, 24)}」`,
              version: source.version, include: direct,
              legacy: source.anchor_id ? { anchor_id: source.anchor_id } : null,
            });
          }
        }
        break;
      }
      case 'link': {
        const link = object.link;
        const relation = link?.relation;
        const ends = `${link?.source_instance ?? '自由端点'} → ${link?.target_instance ?? '自由端点'}`;
        push({
          key: `locate:${object.instance_id}`, group: 'locate', objectId: object.instance_id,
          label: relation ? `研究关系线「${relation.label || relation.kind}」` : `视觉连线${link?.label ? `「${link.label}」` : ''}`,
          detail: `${ends}${link?.view?.detached_from ? ' · 已改接，原关系保留' : ''}`, version: null, include: direct, legacy: null,
        });
        if (relation) {
          const claim = relation.claim;
          push({
            key: `relation:${relation.id}`, group: 'body', objectId: object.instance_id, label: `关系记录：${relation.kind}${relation.label ? `「${relation.label}」` : ''}`,
            detail: claim ? `状态 ${claim.status} · 条件 ${claim.conditions || '—'} · 反例 ${claim.counterexamples || '—'}` : '尚无论证记录',
            version: null, include: direct, legacy: null,
          });
        }
        break;
      }
      case 'group':
      case 'frame':
        push({
          key: `locate:${object.instance_id}`, group: 'locate', objectId: object.instance_id, label: `${object.kind === 'group' ? '分组' : '框'}「${object.title}」`,
          detail: `${object.child_ids.length} 个子对象 · ${position(object)}`, version: null, include: direct, legacy: null,
        });
        break;
      case 'image':
        push({
          key: `locate:${object.instance_id}`, group: 'locate', objectId: object.instance_id, label: `图片「${object.title}」`,
          detail: `${position(object)}${via}`, version: null, include: direct, legacy: null,
        });
        // 图像内容只在用户明确选择后交给视觉模型
        if (object.asset_id) {
          push({
            key: `visual:${object.instance_id}`, group: 'visual', objectId: object.instance_id, label: `以图像读取「${object.title}」`,
            detail: '原图作为视觉输入，附对象标识与位置', version: null, include: false, legacy: null, asset_id: object.asset_id,
          });
        }
        break;
      default:
        push({
          key: `locate:${object.instance_id}`, group: 'locate', objectId: object.instance_id, label: object.title,
          detail: object.unreadable ?? position(object), version: null, include: direct, legacy: null,
        });
    }
  }
  return result;
}

/** 期望材料：用户选入且可提交的项，以及父讨论的冻结来源。 */
export function expectedFromMaterials(materials: Material[]): ExpectedSource[] {
  const expected: ExpectedSource[] = [];
  for (const material of materials) {
    if (!material.include) continue;
    if (material.legacy && 'anchor_id' in material.legacy) expected.push({ document_id: '', version: material.version, anchor_id: material.legacy.anchor_id, origin: material.label });
    else if (material.legacy) expected.push({ document_id: material.legacy.document_id, version: material.version, anchor_id: null, origin: material.label });
  }
  return expected;
}

/** 父讨论的冻结材料：讨论问答本身及其上下文快照中的来源。 */
export function inheritedSources(discussionIds: string[], documents: Map<string, ResearchDocument>, contexts: Record<string, ResearchContext>) {
  const expected: ExpectedSource[] = [];
  const missing: Array<{ id: string; title: string; reason: string }> = [];
  for (const id of discussionIds) {
    const doc = documents.get(id);
    const title = doc?.metadata.question ?? doc?.title ?? '讨论';
    expected.push({ document_id: id, version: doc?.current_version ?? null, anchor_id: null, origin: `讨论「${title}」` });
    const contextId = doc?.metadata.context_id;
    if (!contextId) { missing.push({ id, title, reason: '没有记录 context_id，无法恢复原材料范围' }); continue; }
    const context = contexts[contextId];
    if (!context) { missing.push({ id, title, reason: `上下文 ${contextId} 尚未读取或已缺失` }); continue; }
    for (const source of context.sources) {
      expected.push({ document_id: source.document_id, version: source.version, anchor_id: source.anchor_id, origin: `讨论「${title}」` });
    }
  }
  return { expected, missing };
}

export type ScopeReport = {
  /** 期望且实际存在 */
  kept: Array<{ source: ContextSource; origins: string[] }>;
  /** 实际存在但不在期望中，例如服务沿来源关系扩展出的全文 */
  extra: ContextSource[];
  /** 期望整篇但实际版本不同 */
  shifted: Array<{ source: ContextSource; expected: number | null }>;
  /** 期望但实际缺失 */
  missing: ExpectedSource[];
};

/** 比较实际上下文与期望材料。片段按锚点身份比较，整篇按文稿与版本比较。 */
export function scopeReport(context: ResearchContext, expected: ExpectedSource[]): ScopeReport {
  const report: ScopeReport = { kept: [], extra: [], shifted: [], missing: [] };
  const matched = new Set<ExpectedSource>();
  for (const source of context.sources) {
    const hits = expected.filter(item => source.anchor_id
      ? item.anchor_id === source.anchor_id
      : !item.anchor_id && item.document_id === source.document_id);
    if (hits.length === 0) { report.extra.push(source); continue; }
    hits.forEach(hit => matched.add(hit));
    const exact = hits.filter(hit => source.anchor_id || hit.version === null || hit.version === source.version);
    if (exact.length === 0) report.shifted.push({ source, expected: hits[0].version });
    else report.kept.push({ source, origins: Array.from(new Set(exact.map(hit => hit.origin))) });
  }
  // 同一身份的期望只需出现一次
  const seen = new Set<string>();
  for (const item of expected) {
    if (matched.has(item)) continue;
    const key = sourceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!context.sources.some(source => sourceKey({ document_id: source.document_id, version: source.version, anchor_id: source.anchor_id }) === key)) report.missing.push(item);
  }
  return report;
}
