import { useEffect, useState, useRef } from "preact/hooks";
import { SCROLL_THRESHOLD } from "../config";

type DivRef = { current: HTMLDivElement | null };

export function useAutoScroll(
  messages: readonly unknown[],
  listRef: DivRef,
  threshold: number = SCROLL_THRESHOLD,
) {
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const prevLen = useRef(0);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = (): void => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowScrollBtn(false);
    setPendingCount(0);
    isNearBottomRef.current = true;
  };

  const handleScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist < threshold + 50;
    isNearBottomRef.current = near;
    setShowScrollBtn(dist > threshold);
    if (near) setPendingCount(0);
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const currLen = Array.isArray(messages) ? messages.length : 0;
    const prev = prevLen.current;
    const grew = currLen > prev;
    if (grew) {
      if (prev === 0) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      } else if (isNearBottomRef.current) {
        requestAnimationFrame(() => {
          if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold + 200) {
            el.scrollTop = el.scrollHeight;
            setPendingCount(0);
          } else {
            const delta = currLen - prev;
            setPendingCount((p) => p + delta);
            setShowScrollBtn(true);
          }
        });
      } else {
        const delta = currLen - prev;
        setPendingCount((p) => p + delta);
        setShowScrollBtn(true);
      }
    }
    prevLen.current = currLen;
  }, [messages.length, threshold]);

  return { showScrollBtn, pendingCount, scrollToBottom, handleScroll };
}
