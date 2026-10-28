import type { AnchorStatus, ClaimStatus, DocumentKind, FileTextStatus, RunStatus, Usage } from '@research';

export const KIND_LABEL: Record<DocumentKind, string> = {
  document: '研究文稿',
  note: '想法',
  discussion: '讨论',
  pdf: 'PDF',
  image: '图片',
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

export const ANCHOR_STATUS_LABEL: Record<AnchorStatus, string> = {
  exact: '原位',
  relocated: '已重定位',
  changed: '原文已改',
  missing: '定位失效',
  ambiguous: '多处匹配',
};

export const ANCHOR_STATUS_HINT: Record<AnchorStatus, string> = {
  exact: '引用片段仍在原块的原位置',
  relocated: '原文移动后已在当前版本中找到同一片段',
  changed: '原块仍在，但引用片段已被修改',
  missing: '当前版本中找不到引用片段',
  ambiguous: '当前版本中有多处相同片段，无法唯一定位',
};

/** 五种研究状态；历史值 verified 按“已确立”显示。 */
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  analogy: '启发',
  candidate: '候选',
  supported: '有支持',
  established: '已确立',
  refuted: '被反驳',
  verified: '已确立',
};

export const MODE_LABEL = { discussion: '讨论', rewrite: '改写选段', relation: '关系分析', canvas: '画布操作' } as const;

export function formatTime(value: string | number | undefined | null) {
  if (value == null) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return `${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${time}`;
}

export function formatUsage(usage: Usage | null | undefined) {
  if (!usage) return '';
  const parts: string[] = [];
  if (typeof usage.prompt_tokens === 'number') parts.push(`输入 ${usage.prompt_tokens.toLocaleString()}`);
  if (typeof usage.completion_tokens === 'number') parts.push(`输出 ${usage.completion_tokens.toLocaleString()}`);
  if (typeof usage.total_tokens === 'number') parts.push(`合计 ${usage.total_tokens.toLocaleString()} tokens`);
  if (typeof usage.cost === 'number') parts.push(`费用 $${usage.cost.toFixed(4)}`);
  if (typeof usage.finish_reason === 'string') parts.push(`结束原因 ${usage.finish_reason}`);
  return parts.join(' · ');
}

export function excerpt(text: string, length = 80) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

export function anchorTone(status: AnchorStatus | null | undefined) {
  if (status === 'exact' || status === 'relocated') return 'ok';
  if (status === 'changed' || status === 'ambiguous') return 'warn';
  if (status === 'missing') return 'bad';
  return 'muted';
}

/** 文件正文的读取状态（导入结果与项目目录条目共用）。 */
export const TEXT_STATUS_LABEL: Record<FileTextStatus, string> = {
  ready: '正文已读取',
  partial: '部分读取',
  image: '图像',
  empty: '文字层为空',
  attachment: '原始附件',
  error: '读取失败',
};

export const TEXT_STATUS_NOTE: Record<FileTextStatus, string> = {
  ready: '正文已读取',
  partial: '部分内容已读取，附有解析说明',
  image: '图像材料，可按图像读取',
  empty: 'PDF 文字层为空，原页可打开',
  attachment: '原件已保存，可下载后用对应应用打开',
  error: '正文提取失败，原件已保留',
};

export function textStatusTone(status: FileTextStatus | 'directory' | null | undefined) {
  if (status === 'error') return 'bad' as const;
  if (status === 'partial' || status === 'empty') return 'warn' as const;
  return 'muted' as const;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}
