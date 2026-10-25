// 用户主动滚动后保留阅读位置，停留在底部时跟随流式内容。
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
