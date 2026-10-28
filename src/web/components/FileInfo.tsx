import type { BlockStdScope } from '@editor/runtime';
import type { Store } from '@editor/document';
import { DownloadIcon, FolderIcon } from '@blocksuite/icons/rc';
import { api, type ResearchDocument } from '@research';
import { blockText, projectedModels, scrollBlockIntoView } from '@research/editor';

import { toast, useApp } from '../app/model';
import { formatBytes, TEXT_STATUS_LABEL, TEXT_STATUS_NOTE, textStatusTone } from '../lib/format';
import { Chip } from './common';

const FORMAT_LABEL: Record<string, string> = {
  xlsx: 'Excel 工作簿', xls: 'Excel 97–2003 工作簿', xlsm: 'Excel 启用宏的工作簿', xlsb: 'Excel 二进制工作簿', ods: 'OpenDocument 表格',
  pptx: 'PowerPoint 演示文稿', ppt: 'PowerPoint 97–2003 演示文稿', pptm: 'PowerPoint 启用宏的演示文稿', ppsx: 'PowerPoint 放映', ppsm: 'PowerPoint 放映',
  docx: 'Word 文稿', ipynb: 'Jupyter Notebook', markdown: 'Markdown', json: 'JSON', jsonl: 'JSON Lines', pdf: 'PDF',
};

/** 滚动到正文中以指定文字开头的标题（工作表或幻灯片）。 */
function scrollToHeading(std: BlockStdScope | null, store: Store | null, heading: string) {
  if (!std || !store) return;
  const target = projectedModels(store).find(model => /^#{1,6} /.test(blockText(model)) && blockText(model).replace(/^#{1,6} /, '').startsWith(heading));
  if (!target || !scrollBlockIntoView(std, target.id)) toast(`正文中没有找到「${heading}」`, 'info');
}

/**
 * 导入文件的来源信息：项目与相对路径、格式、大小、正文读取状态及说明、原件下载；
 * Excel 列出工作表（范围与公式数量），PowerPoint 列出幻灯片页次与标题，点击定位到正文。
 */
export function FileInfo({ doc, std, store }: { doc: ResearchDocument; std: BlockStdScope | null; store: Store | null }) {
  const meta = doc.metadata;
  const project = useApp(state => (meta.project_id ? state.projects.find(item => item.project.id === meta.project_id)?.project ?? null : null));
  const assetId = meta.source_asset_id;
  if (!assetId || !meta.text_status) return null;
  const status = meta.text_status;
  const sheets = meta.import_details?.sheets ?? [];
  const slides = meta.import_details?.slides ?? [];
  const versions = (meta as { source_versions?: Array<{ version: number; asset_id: string }> }).source_versions ?? [];
  const imported = versions.length ? versions[versions.length - 1].version : null;
  const filename = meta.source_filename ?? doc.title;
  const format = meta.file_format ? FORMAT_LABEL[meta.file_format] ?? meta.file_format.toUpperCase() : null;
  return (
    <div className="space-y-1.5 border-b border-line bg-surface-1 px-3 py-2 text-xs" data-testid="file-info">
      <div className="flex flex-wrap items-center gap-1.5">
        {meta.project_id && (
          <span className="inline-flex min-w-0 items-center gap-1 text-ink-secondary" title={`${project?.name ?? '项目'}/${meta.relative_path ?? ''}`}>
            <FolderIcon width={14} height={14} className="shrink-0" aria-hidden="true" />
            <span className="font-medium text-ink">{project?.name ?? '项目'}</span>
            <span className="truncate text-ink-muted">/ {meta.relative_path}</span>
          </span>
        )}
        {format && <Chip>{format}</Chip>}
        {meta.byte_length != null && <Chip>{formatBytes(meta.byte_length)}</Chip>}
        <Chip tone={status === 'ready' ? 'ok' : textStatusTone(status)} title={TEXT_STATUS_NOTE[status]}>{TEXT_STATUS_LABEL[status]}</Chip>
        {imported != null && <Chip title={`共导入 ${versions.length} 次原件；文稿当前为版本 ${doc.current_version}`}>导入版本 {imported}</Chip>}
        {meta.import_details?.legacy && <Chip title="PowerPoint 97–2003 格式，读取可提取的标题、正文和备注">旧版格式</Chip>}
        <a href={api.assetUrl(assetId)} download={filename} className="rc-focus-ring ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-secondary hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink" data-testid="download-original">
          <DownloadIcon width={14} height={14} aria-hidden="true" />下载原件
        </a>
      </div>
      {status !== 'ready' && (
        <p className={`whitespace-pre-wrap ${status === 'error' ? 'text-[var(--rc-bad)]' : status === 'partial' || status === 'empty' ? 'text-[var(--rc-warn)]' : 'text-ink-secondary'}`} data-testid="import-message">
          {meta.import_message ? `${TEXT_STATUS_LABEL[status]}：${meta.import_message}` : `${TEXT_STATUS_NOTE[status]}。`}
        </p>
      )}
      {sheets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-testid="sheet-list">
          <span className="text-ink-muted">工作表</span>
          {sheets.map(sheet => (
            <button key={sheet.name} type="button" onClick={() => scrollToHeading(std, store, `工作表：${sheet.name}`)}
              className="rc-focus-ring inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-ink hover:border-line-strong"
              title={sheet.rows ? `起始 ${sheet.start_column}${sheet.start_row}，${sheet.rows} 行 × ${sheet.columns} 列` : '空工作表'}>
              {sheet.name}
              <span className="text-ink-muted">{sheet.rows ? `${sheet.rows}×${sheet.columns}` : '空'}{sheet.formula_count ? ` · ${sheet.formula_count} 个公式` : ''}</span>
            </button>
          ))}
          {meta.import_details?.formula_values === 'stored' && <span className="text-ink-muted">单元格显示文件保存的值，公式表达式另起一行列出。</span>}
        </div>
      )}
      {slides.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-testid="slide-list">
          <span className="text-ink-muted">幻灯片</span>
          {slides.map(slide => (
            <button key={slide.number} type="button" onClick={() => scrollToHeading(std, store, `幻灯片 ${slide.number}`)}
              className="rc-focus-ring inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-ink hover:border-line-strong" title={slide.title ?? undefined}>
              <span className="tabular-nums text-ink-muted">{slide.number}</span>
              <span className="truncate">{slide.title || '无标题'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
