import type { ResearchSession } from '@research-canvas/research/editor';
import { useSyncExternalStore } from 'react';

import { getSession, useApp } from './model';

const noop = () => () => undefined;

/** 订阅当前工作区编辑会话的保存状态变化。 */
export function useSession(): ResearchSession | null {
  useApp(state => state.workspaceId);
  const session = getSession();
  useSyncExternalStore(session?.subscribe ?? noop, session?.getVersion ?? (() => 0));
  return session;
}
