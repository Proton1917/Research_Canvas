// 设置 → 模型服务：协议、地址、凭据、模型目录与高级请求头。密钥只保存在本次表单内存中，提交后清空。
import { CloseIcon, DeleteIcon, PlusIcon, ResetIcon } from '@blocksuite/icons/rc';
import {
  api, ApiError, type ModelEntry, type ProviderConnection, type ProviderConnectionTest, type ProviderProtocol, type ProviderSettings,
} from '@research';
import { Button, Dialog, SegmentedControl, SkeletonShimmer } from '@ui';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { errorText, refreshProviderState, setDialogs, toast, useApp } from '../app/model';
import { Chip } from './common';

const PROTOCOLS: { id: ProviderProtocol; label: string }[] = [
  { id: 'chat_completions', label: 'Chat Completions' },
  { id: 'anthropic_messages', label: 'Anthropic Messages' },
];

const PROTOCOL_HINT: Record<ProviderProtocol, string> = {
  chat_completions: '请求追加 /chat/completions，密钥以 Bearer Authorization 发送',
  anthropic_messages: '请求追加 /messages，密钥以 x-api-key 发送，并带 anthropic-version',
};

type HeaderRow = { id: number; name: string; value: string };

type Draft = {
  protocol: ProviderProtocol;
  baseUrl: string;
  /** keep：沿用已保存凭据（省略 api_key）；replace：提交新密钥；clear：提交空字符串 */
  keyAction: 'keep' | 'replace' | 'clear';
  key: string;
  /** keep：省略 headers；replace：以 rows 完整替换自定义请求头 */
  headersMode: 'keep' | 'replace';
  headers: HeaderRow[];
  defaultModel: string;
  allowed: string[];
  vision: string[];
};

type TestState =
  | { status: 'ok'; result: ProviderConnectionTest; signature: string }
  | { status: 'error'; message: string; signature: string }
  | null;

type Feedback = { tone: 'error' | 'conflict'; message: string; currentRevision?: number } | null;

let rowSeq = 0;
const unique = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))];
const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

function draftFrom(settings: ProviderSettings): Draft {
  return {
    protocol: settings.protocol,
    baseUrl: settings.base_url,
    keyAction: 'keep',
    key: '',
    headersMode: 'keep',
    headers: [],
    defaultModel: settings.default_model,
    allowed: unique([settings.default_model, ...settings.allowed_models]),
    vision: unique(settings.vision_models),
  };
}

/** 地址或协议与已保存配置不同：已保存的密钥和请求头不会沿用。 */
function connectionChanged(draft: Draft, settings: ProviderSettings) {
  return draft.protocol !== settings.protocol || normalizeUrl(draft.baseUrl) !== normalizeUrl(settings.base_url);
}

function headerError(draft: Draft) {
  if (draft.headersMode !== 'replace') return null;
  const names = new Set<string>();
  for (const row of draft.headers) {
    const name = row.name.trim();
    if (!name && !row.value) continue;
    if (!name) return '请求头需要填写名称';
    if (!row.value) return `请求头 ${name} 需要填写取值`;
    if (names.has(name.toLowerCase())) return `请求头 ${name} 重复`;
    names.add(name.toLowerCase());
  }
  return null;
}

function connectionInput(draft: Draft): ProviderConnection {
  const input: ProviderConnection = { protocol: draft.protocol, base_url: draft.baseUrl.trim() };
  if (draft.keyAction === 'replace' && draft.key.trim()) input.api_key = draft.key.trim();
  if (draft.keyAction === 'clear') input.api_key = '';
  if (draft.headersMode === 'replace') {
    input.headers = Object.fromEntries(draft.headers.filter(row => row.name.trim()).map(row => [row.name.trim(), row.value]));
  }
  return input;
}

/** 连接测试结果对应的表单内容；密钥以输入次数代替，取值不写入签名。 */
function testSignature(draft: Draft, keyEdits: number) {
  const input = connectionInput(draft);
  return JSON.stringify([{ ...input, api_key: input.api_key ? `edit:${keyEdits}` : input.api_key }, draft.defaultModel.trim()]);
}

/** 比较是否有未保存的修改；模型列表按集合比较。 */
function draftKey(draft: Draft) {
  return JSON.stringify({ ...draft, headers: draft.headers.map(({ name, value }) => [name, value]), defaultModel: draft.defaultModel.trim(),
    allowed: unique([draft.defaultModel, ...draft.allowed]).sort(), vision: unique(draft.vision).sort() });
}

function CredentialStatus({ settings }: { settings: ProviderSettings }) {
  switch (settings.credential_source) {
    case 'saved': return <Chip tone="ok">已保存密钥</Chip>;
    case 'environment': return settings.api_key_configured
      ? <Chip tone="ok" title="密钥来自服务配置引用的环境变量">环境变量提供密钥</Chip>
      : <Chip tone="warn" title="服务配置引用的环境变量当前未设置">环境变量未设置</Chip>;
    case 'headers': return <Chip tone="ok" title="认证来自高级区域的自定义请求头">认证请求头已配置</Chip>;
    default: return <Chip>未配置密钥</Chip>;
  }
}

function Field({ label, htmlFor, hint, children, aside }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink">{label}</label>
        {aside}
      </div>
      {children}
      {hint && <div className="text-[11px] leading-relaxed text-ink-muted">{hint}</div>}
    </div>
  );
}

function TestResult({ test, stale }: { test: NonNullable<TestState>; stale: boolean }) {
  if (test.status === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs" data-testid="provider-test-result">
        <p className="font-medium text-[var(--rc-bad)]">连接失败</p>
        <p className="mt-0.5 break-words text-ink-secondary">{test.message}</p>
        {stale && <p className="mt-1 text-ink-muted">表单已修改，结果对应修改前的配置。</p>}
      </div>
    );
  }
  const { result } = test;
  const count = result.models.length;
  const available = result.model_available;
  return (
    <div role="status" className={`rounded-lg border px-3 py-2 text-xs ${available === false ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/5'}`} data-testid="provider-test-result">
      <p className="font-medium text-ink">已连接，取得 {count} 个模型的目录{count === 0 ? '（目录为空，可手动填写模型 ID）' : ''}</p>
      <p className="mt-0.5 text-ink-secondary">
        {result.model === null && '未指定默认模型，可从下方目录选择。'}
        {result.model !== null && available && <>默认模型 <span className="font-mono">{result.model}</span> 在目录中。</>}
        {result.model !== null && available === false && <>默认模型 <span className="font-mono">{result.model}</span> 不在目录中，请从目录选择或核对模型 ID；保存后生成结果以服务响应为准。</>}
      </p>
      <p className="mt-0.5 text-ink-muted">连接测试读取模型目录，实际生成在讨论中确认。</p>
      {stale && <p className="mt-1 text-[var(--rc-warn)]">表单已修改，结果对应修改前的配置。</p>}
    </div>
  );
}

function ModelTable({ draft, saved, entries, tested, onChange }: {
  draft: Draft; saved: string[]; entries: ModelEntry[]; tested: boolean; onChange: (patch: Partial<Draft>) => void;
}) {
  const [filter, setFilter] = useState('');
  const [manual, setManual] = useState('');
  const names = useMemo(() => new Map(entries.map(entry => [entry.id, entry.name && entry.name !== entry.id ? entry.name : null])), [entries]);
  // 行顺序固定：已保存的模型、目录条目、手动添加；勾选时行位置不变
  const rows = useMemo(() => unique([...saved, ...entries.map(entry => entry.id), ...draft.allowed, ...draft.vision, draft.defaultModel]), [saved, entries, draft.allowed, draft.vision, draft.defaultModel]);
  const query = filter.trim().toLowerCase();
  const visible = query ? rows.filter(id => id.toLowerCase().includes(query) || (names.get(id) ?? '').toLowerCase().includes(query)) : rows;
  const defaultId = draft.defaultModel.trim();
  const toggleAllowed = (id: string, on: boolean) => onChange(on
    ? { allowed: unique([...draft.allowed, id]) }
    : { allowed: draft.allowed.filter(item => item !== id), vision: draft.vision.filter(item => item !== id) });
  const toggleVision = (id: string, on: boolean) => onChange(on
    ? { vision: unique([...draft.vision, id]), allowed: unique([...draft.allowed, id]) }
    : { vision: draft.vision.filter(item => item !== id) });
  const add = () => {
    const id = manual.trim();
    if (!id) return;
    onChange({ allowed: unique([...draft.allowed, id]), defaultModel: defaultId ? draft.defaultModel : id });
    setManual('');
  };
  return (
    <div className="space-y-2" data-testid="provider-models">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink">启用模型与图像模型</span>
        <Chip>{unique([defaultId, ...draft.allowed]).length} 个启用</Chip>
        <Chip>{draft.vision.length} 个读取图像</Chip>
        {!tested && <span className="text-[11px] text-ink-muted">测试连接后显示服务的完整目录</span>}
      </div>
      {rows.length > 8 && (
        <input aria-label="筛选模型" className="rc-input text-xs" placeholder={`在 ${rows.length} 个模型中筛选`} value={filter} onChange={event => setFilter(event.target.value)} />
      )}
      <div className="rc-scroll max-h-64 overflow-y-auto rounded-lg border border-line">
        <table className="w-full table-fixed text-xs">
          <thead className="sticky top-0 bg-surface-2 text-[11px] text-ink-muted">
            <tr className="border-b border-line">
              <th className="px-2.5 py-1.5 text-left font-medium">模型 ID</th>
              <th className="w-12 px-1 py-1.5 text-center font-medium">默认</th>
              <th className="w-12 px-1 py-1.5 text-center font-medium">启用</th>
              <th className="w-12 px-1 py-1.5 text-center font-medium">图像</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(id => {
              const isDefault = id === defaultId;
              const enabled = isDefault || draft.allowed.includes(id);
              const missing = tested && !names.has(id);
              return (
                <tr key={id} className={`border-b border-line last:border-b-0 ${isDefault ? 'bg-clay/5' : ''}`}>
                  <td className="min-w-0 px-2.5 py-1.5">
                    <span className="block truncate font-mono text-[12px] text-ink" title={id}>{id}</span>
                    {(names.get(id) || missing) && (
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-muted">
                        {names.get(id) && <span className="min-w-0 truncate">{names.get(id)}</span>}
                        {missing && <Chip tone="warn" title="连接测试取得的目录中没有该模型 ID">目录中未找到</Chip>}
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    <input type="radio" name="provider-default-model" aria-label={`将 ${id} 设为默认模型`} className="accent-[var(--cds-clay)]" checked={isDefault}
                      onChange={() => onChange({ defaultModel: id, allowed: unique([...draft.allowed, id]) })} />
                  </td>
                  <td className="text-center">
                    <input type="checkbox" aria-label={`启用 ${id}`} className="accent-[var(--cds-clay)]" checked={enabled} disabled={isDefault}
                      title={isDefault ? '默认模型自动启用' : undefined} onChange={event => toggleAllowed(id, event.target.checked)} />
                  </td>
                  <td className="text-center">
                    <input type="checkbox" aria-label={`${id} 读取图像`} className="accent-[var(--cds-clay)]" checked={draft.vision.includes(id)}
                      onChange={event => toggleVision(id, event.target.checked)} />
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={4} className="px-2.5 py-3 text-center text-ink-muted">{rows.length ? '没有匹配的模型' : '尚无模型。测试连接读取目录，或在下方填写模型 ID。'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <form className="flex gap-1.5" onSubmit={event => { event.preventDefault(); add(); }}>
        <input aria-label="手动添加模型 ID" className="rc-input min-w-0 flex-1 font-mono text-xs" placeholder="手动添加准确的模型 ID" spellCheck={false} autoComplete="off" value={manual} onChange={event => setManual(event.target.value)} />
        <Button type="submit" size="sm" variant="secondary" icon={<PlusIcon width={14} height={14} />} disabled={!manual.trim()}>添加</Button>
      </form>
    </div>
  );
}

function HeadersSection({ draft, settings, changed, onChange }: {
  draft: Draft; settings: ProviderSettings; changed: boolean; onChange: (patch: Partial<Draft>) => void;
}) {
  const saved = settings.header_names;
  const startReplace = (names: string[]) => onChange({ headersMode: 'replace', headers: names.map(name => ({ id: ++rowSeq, name, value: '' })) });
  const patchRow = (id: number, patch: Partial<HeaderRow>) => onChange({ headers: draft.headers.map(row => (row.id === id ? { ...row, ...patch } : row)) });
  return (
    <details className="rounded-lg border border-line px-3 py-2" open={draft.headersMode === 'replace' || undefined} data-testid="provider-advanced">
      <summary className="rc-focus-ring cursor-pointer rounded text-xs font-medium text-ink-secondary">
        高级 · 自定义请求头{saved.length > 0 && ` · 已保存 ${saved.length} 项`}{draft.headersMode === 'replace' && ' · 将替换'}
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-[11px] leading-relaxed text-ink-muted">请求头的取值保存在服务端，读取时只返回名称；修改时以下方完整列表替换整组请求头。与 API Key 同时提交时，认证头由 API Key 确定。</p>
        {draft.headersMode === 'keep' ? (
          <>
            {saved.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-muted">已保存：</span>
                {saved.map(name => <Chip key={name} className="font-mono">{name}</Chip>)}
                {changed && <span className="text-[var(--rc-warn)]">更换地址或协议后不会沿用</span>}
              </div>
            ) : <p className="text-ink-muted">没有自定义请求头。</p>}
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="secondary" onClick={() => startReplace(saved.length ? saved : [''])}>{saved.length ? '修改请求头' : '添加请求头'}</Button>
              {saved.length > 0 && <Button size="xs" variant="ghost" onClick={() => onChange({ headersMode: 'replace', headers: [] })}>清空请求头</Button>}
            </div>
          </>
        ) : (
          <>
            {draft.headers.length === 0 && <p className="text-[var(--rc-warn)]">保存后将清空全部自定义请求头。</p>}
            <ul className="space-y-1.5">
              {draft.headers.map(row => (
                <li key={row.id} className="flex gap-1.5">
                  <input aria-label="请求头名称" className="rc-input w-[38%] min-w-0 font-mono text-xs" placeholder="名称" spellCheck={false} autoComplete="off" value={row.name} onChange={event => patchRow(row.id, { name: event.target.value })} />
                  <input aria-label={`请求头 ${row.name || ''} 的取值`} type="password" className="rc-input min-w-0 flex-1 font-mono text-xs" placeholder={saved.includes(row.name) ? '重新填写取值' : '取值'} spellCheck={false} autoComplete="new-password" value={row.value} onChange={event => patchRow(row.id, { value: event.target.value })} />
                  <Button size="icon-sm" variant="ghost" aria-label={`移除请求头 ${row.name}`} icon={<DeleteIcon width={14} height={14} />} onClick={() => onChange({ headers: draft.headers.filter(item => item.id !== row.id) })} />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="secondary" icon={<PlusIcon width={12} height={12} />} onClick={() => onChange({ headers: [...draft.headers, { id: ++rowSeq, name: '', value: '' }] })}>添加一行</Button>
              <Button size="xs" variant="ghost" icon={<ResetIcon width={12} height={12} />} onClick={() => onChange({ headersMode: 'keep', headers: [] })}>保留已保存的请求头</Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

export function SettingsDialog() {
  const open = useApp(state => !!state.dialogs.settings);
  const catalog = useApp(state => state.catalog);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>(null);
  const [busy, setBusy] = useState<'load' | 'test' | 'save' | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [keyEdits, setKeyEdits] = useState(0);
  const feedbackRef = useRef<HTMLDivElement>(null);
  // 保存失败或冲突的提示位于表单末尾，出现时滚动到可见位置
  useEffect(() => { if (feedback) feedbackRef.current?.scrollIntoView({ block: 'nearest' }); }, [feedback]);

  const load = useCallback(async () => {
    setBusy('load');
    setLoadError(null);
    try {
      const current = await api.providerSettings();
      setSettings(current);
      setRevision(current.revision);
      setDraft(draftFrom(current));
      setTest(null);
      setFeedback(null);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setBusy(null);
    }
  }, []);

  // 每次打开读取当前设置；关闭后表单与密钥一并丢弃
  useEffect(() => {
    if (open) { void load(); return; }
    setSettings(null); setDraft(null); setTest(null); setFeedback(null); setConfirmClose(false); setLoadError(null);
  }, [open, load]);

  const dirty = !!settings && !!draft && draftKey(draft) !== draftKey(draftFrom(settings));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Dialog 依据 onClose 身份管理焦点，回调保持稳定
  const requestClose = useCallback(() => {
    if (busyRef.current === 'save') return;
    if (dirtyRef.current) setConfirmClose(true);
    else setDialogs({ settings: false });
  }, []);

  const patch = (next: Partial<Draft>) => { setDraft(current => (current ? { ...current, ...next } : current)); setConfirmClose(false); };

  const changed = !!settings && !!draft && connectionChanged(draft, settings);
  const headersProblem = draft ? headerError(draft) : null;
  const signature = draft ? testSignature(draft, keyEdits) : '';
  const entries = test?.status === 'ok' ? test.result.models : catalog?.models ?? [];
  const savedModels = useMemo(() => (settings ? unique([settings.default_model, ...settings.allowed_models, ...settings.vision_models]) : []), [settings]);

  const runTest = async () => {
    if (!draft) return;
    if (headersProblem) { setTest({ status: 'error', message: headersProblem, signature }); return; }
    setBusy('test');
    const sent = signature;
    try {
      const result = await api.testProviderConnection({ ...connectionInput(draft), model: draft.defaultModel.trim() || undefined });
      setTest({ status: 'ok', result, signature: sent });
    } catch (error) {
      setTest({ status: 'error', message: errorText(error), signature: sent });
    } finally {
      setBusy(null);
    }
  };

  const save = async (expected = revision) => {
    if (!draft || !settings) return;
    const defaultModel = draft.defaultModel.trim();
    if (!draft.baseUrl.trim()) { setFeedback({ tone: 'error', message: '请填写 API 基础地址' }); return; }
    if (!defaultModel) { setFeedback({ tone: 'error', message: '请选择或填写默认模型' }); return; }
    if (headersProblem) { setFeedback({ tone: 'error', message: headersProblem }); return; }
    const allowed = unique([defaultModel, ...draft.allowed]);
    setBusy('save');
    setFeedback(null);
    try {
      const saved = await api.saveProviderSettings({
        ...connectionInput(draft),
        expected_revision: expected,
        default_model: defaultModel,
        allowed_models: allowed,
        vision_models: draft.vision.filter(id => allowed.includes(id)),
      });
      // 提交完成：密钥随表单一起丢弃，界面状态以服务返回的设置为准
      setSettings(saved);
      setRevision(saved.revision);
      setDraft(draftFrom(saved));
      setDialogs({ settings: false });
      const state = await refreshProviderState(saved);
      toast(state.catalogError
        ? `模型设置已保存（修订 ${saved.revision}）。模型目录读取失败：${state.catalogError}`
        : `模型设置已保存（修订 ${saved.revision}），讨论与画布提问使用 ${state.model || saved.default_model}`, state.catalogError ? 'error' : 'success');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'settings_conflict') {
        const current = error.details.current_revision;
        setFeedback({ tone: 'conflict', message: error.message, currentRevision: typeof current === 'number' ? current : undefined });
      } else {
        setFeedback({ tone: 'error', message: errorText(error) });
      }
    } finally {
      setBusy(null);
    }
  };

  const keyPlaceholder = !settings ? '' : changed
    ? '填写该服务的 API Key'
    : draft?.keyAction === 'clear' ? '保存后清除已保存的认证'
      : settings.api_key_configured ? '已配置，留空沿用；输入新密钥以替换' : '输入 API Key';

  return (
    <Dialog open={open} onClose={requestClose} title="设置" width="max-w-2xl"
      description="模型服务配置保存在本机服务端，保存后立即用于新的讨论与画布提问。"
      footer={confirmClose ? (
        <>
          <span className="mr-auto text-xs text-ink-secondary">放弃未保存的修改？</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>继续编辑</Button>
          <Button size="sm" variant="secondary" onClick={() => setDialogs({ settings: false })}>放弃修改</Button>
        </>
      ) : (
        <>
          {dirty && <span className="mr-auto text-[11px] text-ink-muted">有未保存的修改</span>}
          <Button size="sm" variant="ghost" disabled={busy === 'save'} onClick={requestClose}>取消</Button>
          <Button size="sm" variant="secondary" isLoading={busy === 'test'} disabled={!draft || busy !== null || !draft.baseUrl.trim()} onClick={() => void runTest()}>测试连接并读取模型</Button>
          <Button size="sm" variant="primary" isLoading={busy === 'save'} disabled={!draft || busy !== null} onClick={() => void save()}>保存</Button>
        </>
      )}>
      <div className="space-y-4" data-testid="provider-settings">
        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
          <h3 className="text-[13px] font-semibold text-ink">模型服务</h3>
          {settings && <Chip title="保存时以此修订号检查并发修改">修订 {revision}</Chip>}
          {settings && <CredentialStatus settings={settings} />}
        </div>

        {busy === 'load' && !draft && <div className="space-y-3"><SkeletonShimmer height={52} /><SkeletonShimmer height={52} /><SkeletonShimmer height={52} /><SkeletonShimmer height={160} /></div>}
        {loadError && !draft && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-[var(--rc-bad)]">
            <span className="min-w-0 flex-1">读取模型设置失败：{loadError}</span>
            <Button size="xs" variant="secondary" onClick={() => void load()}>重试</Button>
          </div>
        )}

        {settings && draft && (
          <>
            <Field label="协议" hint={PROTOCOL_HINT[draft.protocol]}>
              <SegmentedControl ariaLabel="协议" size="sm" items={PROTOCOLS} value={draft.protocol} onChange={protocol => patch({ protocol })} />
            </Field>

            <Field label="API 基础地址" htmlFor="provider-base-url" hint="服务商域名或本机网关的基础路径，例如 http://127.0.0.1:43177/v1">
              <input id="provider-base-url" className="rc-input font-mono text-[13px]" inputMode="url" spellCheck={false} autoComplete="off" placeholder="https://api.example.com/v1"
                value={draft.baseUrl} onChange={event => patch({ baseUrl: event.target.value })} />
            </Field>

            {changed && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-ink" data-testid="provider-reauth">
                API 地址或协议已变化，已保存的密钥{settings.header_names.length > 0 ? '和自定义请求头' : ''}不会沿用。请在下方填写该服务的 API Key，或在高级区域提供认证请求头。
              </p>
            )}

            <Field label="API Key" htmlFor="provider-api-key"
              aside={!changed && settings.api_key_configured && (draft.keyAction === 'clear'
                ? <span className="flex items-center gap-1.5"><Chip tone="warn">保存后清除</Chip><Button size="xs" variant="ghost" onClick={() => patch({ keyAction: 'keep', key: '' })}>撤销清除</Button></span>
                : <Button size="xs" variant="ghost" icon={<CloseIcon width={12} height={12} />} onClick={() => patch({ keyAction: 'clear', key: '' })}>
                  {settings.credential_source === 'headers' ? '清除认证请求头' : '清除已保存的密钥'}
                </Button>)}
              hint={draft.keyAction === 'replace' && draft.key ? '保存时提交新密钥并替换现有认证' : settings.credential_source === 'environment' ? '当前密钥来自环境变量；填写新密钥后改为保存在本机配置中' : undefined}>
              <input id="provider-api-key" type="password" className="rc-input font-mono text-[13px]" spellCheck={false} autoComplete="new-password" placeholder={keyPlaceholder}
                value={draft.key} onChange={event => { setKeyEdits(count => count + 1); patch({ key: event.target.value, keyAction: event.target.value ? 'replace' : draft.keyAction === 'replace' ? 'keep' : draft.keyAction }); }} />
            </Field>

            <Field label="默认模型" htmlFor="provider-default-model" hint="可从目录选择，也可填写服务的准确模型 ID；默认模型自动启用"
              aside={test?.status === 'ok' && test.result.model === draft.defaultModel.trim() && test.result.model_available !== null
                ? <Chip tone={test.result.model_available ? 'ok' : 'warn'}>{test.result.model_available ? '目录中存在' : '目录中未找到'}</Chip> : undefined}>
              <input id="provider-default-model" list="provider-model-options" className="rc-input font-mono text-[13px]" spellCheck={false} autoComplete="off" placeholder="例如 cc/gemini-3.8-flash-high"
                value={draft.defaultModel} onChange={event => patch({ defaultModel: event.target.value })} />
              <datalist id="provider-model-options">
                {unique([...entries.map(entry => entry.id), ...draft.allowed]).map(id => <option key={id} value={id} />)}
              </datalist>
            </Field>

            {test && <TestResult test={test} stale={test.signature !== signature} />}

            <ModelTable draft={draft} saved={savedModels} entries={entries} tested={test?.status === 'ok'} onChange={patch} />

            <HeadersSection draft={draft} settings={settings} changed={changed} onChange={patch} />

            <div ref={feedbackRef} className="empty:hidden">
              {feedback?.tone === 'error' && <p role="alert" className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-[var(--rc-bad)]">{feedback.message}</p>}
              {feedback?.tone === 'conflict' && (
                <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid="provider-conflict">
                  <p className="text-ink">{feedback.message}{feedback.currentRevision !== undefined && `（当前修订 ${feedback.currentRevision}，本表单基于修订 ${revision}）`}。表单中的输入仍保留。</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="xs" variant="secondary" disabled={busy !== null} onClick={() => void load()}>载入当前设置</Button>
                    {feedback.currentRevision !== undefined && (
                      <Button size="xs" variant="primary" disabled={busy !== null} onClick={() => { setRevision(feedback.currentRevision!); void save(feedback.currentRevision); }}>按修订 {feedback.currentRevision} 再次保存</Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
