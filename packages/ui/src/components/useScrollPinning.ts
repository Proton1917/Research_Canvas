// 来源：Open Claude UI 02d021fceaf2a907f9e63a8125621bdda1b85d60 code-examples/useClaudeScrollPinning.ts（MIT）。
// 适配：类型化依赖；用户滚轮、触摸或按键后 150ms 内不抢占视口，离开底部时保留阅读位置。
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export function useScrollPinning(dependencies: DependencyList) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [showJumpControl, setShowJumpControl] = useState(false);
  const lastUserInputAt = useRef(0);
  const programmaticScroll = useRef(false);

  const markUserInput = useCallback(() => {
    lastUserInputAt.current = performance.now();
  }, []);

  const handleScroll = useCallback(() => {
    if (programmaticScroll.current) { programmaticScroll.current = false; return; }
    const element = containerRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsPinned(distance <= 40);
    setShowJumpControl(distance > 120);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const element = containerRef.current;
    if (!element) return;
    programmaticScroll.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setIsPinned(true);
    setShowJumpControl(false);
  }, []);

  useEffect(() => {
    if (performance.now() - lastUserInputAt.current <= 150) return;
    if (isPinned) scrollToBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { containerRef, isPinned, showJumpControl, markUserInput, handleScroll, scrollToBottom };
}
