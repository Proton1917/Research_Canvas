function isVisible(elem: HTMLElement) {
  return (
    !!elem &&
    !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length)
  );
}

export function onClickOutside(
  element: HTMLElement,
  callback: (element: HTMLElement, target: HTMLElement) => void,
  event: 'click' | 'mousedown' = 'click',
  reusable = false
): () => void {
  const outsideClickListener = (event: Event) => {
    // support shadow dom
    const path = event.composedPath && event.composedPath();
    const isOutside = path
      ? path.indexOf(element) < 0
      : !element.contains(event.target as Node) && isVisible(element);

    if (!isOutside) return;

    callback(element, event.target as HTMLElement);
    // if reuseable, need to manually remove the listener
    if (!reusable) removeClickListener();
  };

  document.addEventListener(event, outsideClickListener);
  const removeClickListener = () => {
    document.removeEventListener(event, outsideClickListener);
  };

  return removeClickListener;
}

export const getResultInRange = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};
