import { useRef, useSyncExternalStore } from 'react';

/** 轻量外部状态容器，配合 useSyncExternalStore 使用。 */
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update: Partial<T> | ((state: T) => Partial<T>)) {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function shallowEqual(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** 订阅派生值；派生结果浅比较相同时沿用上一次引用，避免数组派生导致重复渲染。 */
export function useStore<T, S>(store: { get: () => T; subscribe: (listener: () => void) => () => void }, selector: (state: T) => S): S {
  const last = useRef<{ value: S } | null>(null);
  const snapshot = () => {
    const next = selector(store.get());
    if (last.current && shallowEqual(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, snapshot);
}
