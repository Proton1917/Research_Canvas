import katex from 'katex';
import type { Nodes, Root } from 'mdast';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { combineExtensions } from 'micromark-util-combine-extensions';
import { type ReactNode, memo, useMemo } from 'react';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { type Processor, unified } from 'unified';

// 模型回答按 Markdown 渲染：GFM 表格、删除线、任务列表、自动链接，以及 $…$ / $$…$$ 公式。
function remarkGfm(this: Processor) {
  const data = this.data() as Record<string, unknown[]>;
  (data.micromarkExtensions ??= []).push(combineExtensions([gfmAutolinkLiteral(), gfmStrikethrough(), gfmTable(), gfmTaskListItem()]));
  (data.fromMarkdownExtensions ??= []).push([
    gfmStrikethroughFromMarkdown(), gfmTableFromMarkdown(), gfmTaskListItemFromMarkdown(), gfmAutolinkLiteralFromMarkdown(),
  ]);
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function Formula({ value, display }: { value: string; display: boolean }) {
  const html = useMemo(() => katex.renderToString(value, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' }), [value, display]);
  // KaTeX 输出由本地库生成，throwOnError=false 时非法输入显示为红色原文
  return display
    ? <div className="rc-md-math overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
    : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function safeHref(url: string) {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined;
}

function children(node: { children: Nodes[] }) {
  return node.children.map((child, index) => render(child, index));
}

function render(node: Nodes, key: number): ReactNode {
  switch (node.type) {
    case 'root': return children(node);
    case 'paragraph': return <p key={key}>{children(node)}</p>;
    case 'heading': {
      const Tag = (`h${Math.min(node.depth + 2, 6)}`) as 'h3';
      return <Tag key={key}>{children(node)}</Tag>;
    }
    case 'text': return node.value;
    case 'strong': return <strong key={key}>{children(node)}</strong>;
    case 'emphasis': return <em key={key}>{children(node)}</em>;
    case 'delete': return <del key={key}>{children(node)}</del>;
    case 'inlineCode': return <code key={key}>{node.value}</code>;
    case 'code': return <pre key={key}><code>{node.value}</code></pre>;
    case 'blockquote': return <blockquote key={key}>{children(node)}</blockquote>;
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul';
      return <Tag key={key} start={node.ordered && node.start != null && node.start !== 1 ? node.start : undefined}>{children(node)}</Tag>;
    }
    case 'listItem': return (
      <li key={key} className={node.checked != null ? 'rc-md-task' : undefined}>
        {node.checked != null && <input type="checkbox" checked={node.checked} readOnly disabled aria-label={node.checked ? '已完成' : '未完成'} />}
        {node.children.map((child, index) => (!node.spread && child.type === 'paragraph' ? <span key={index}>{children(child)}</span> : render(child, index)))}
      </li>
    );
    case 'link': {
      const href = safeHref(node.url);
      return href ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{children(node)}</a> : <span key={key}>{children(node)}</span>;
    }
    case 'image': return <span key={key}>{node.alt || node.url}</span>;
    case 'thematicBreak': return <hr key={key} />;
    case 'break': return <br key={key} />;
    case 'table': return (
      <div key={key} className="overflow-x-auto">
        <table>
          <tbody>{node.children.map((row, r) => (
            <tr key={r}>{row.children.map((cell, c) => {
              const Cell = r === 0 ? 'th' : 'td';
              return <Cell key={c} style={{ textAlign: node.align?.[c] ?? undefined }}>{children(cell)}</Cell>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
    );
    case 'math': return <Formula key={key} value={node.value} display />;
    case 'inlineMath': return <Formula key={key} value={node.value} display={false} />;
    case 'html': return node.value;
    default: return 'children' in node ? children(node as { children: Nodes[] }) : 'value' in node ? String(node.value) : null;
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tree = useMemo(() => processor.parse(text) as Root, [text]);
  return <div className="rc-md">{render(tree, 0)}</div>;
});
