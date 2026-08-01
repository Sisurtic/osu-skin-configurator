// Shared scroll edge-fade overlays: top/bottom gradient masks on a scroll
// container that fade content in/out as it scrolls under the viewport edges.
// The top fade sits BELOW the sticky thead (offset by its height) so it covers
// the first scrolling row, not the header itself.
//
// Usage: setupEdgeFade(relativeEl, scrollEl, bg)
//   relativeEl — the positioned ancestor the fades attach to
//   scrollEl   — the scroller (defaults to relativeEl)
//   bg         — optional solid color for the gradient (else CSS var default)
window.setupEdgeFade = function setupEdgeFade(relativeEl, scrollEl, bg) {
  if (!relativeEl || relativeEl._fadeBound) return;
  relativeEl._fadeBound = true;
  relativeEl.style.position = 'relative';
  const scroller = scrollEl || relativeEl;
  const topFade = document.createElement('div');
  topFade.className = 'scroll-edge-fade scroll-edge-fade--top';
  const botFade = document.createElement('div');
  botFade.className = 'scroll-edge-fade scroll-edge-fade--bottom';
  if (bg) {
    topFade.style.background = `linear-gradient(to bottom, ${bg} 0%, transparent 100%)`;
    botFade.style.background = `linear-gradient(to top, ${bg} 0%, transparent 100%)`;
  }
  relativeEl.appendChild(topFade);
  relativeEl.appendChild(botFade);
  const updateFade = () => {
    const r = scroller.getBoundingClientRect();
    const cr = relativeEl.getBoundingClientRect();
    if (r.height === 0) return;
    // Offset the top fade by the sticky thead's height so it sits BELOW the
    // header (covering the first scrolling row), not on top of it.
    const thead = scroller.querySelector('thead');
    const thH = thead ? thead.getBoundingClientRect().height : 0;
    topFade.style.top = (r.top - cr.top + thH) + 'px';
    botFade.style.bottom = (cr.bottom - r.bottom) + 'px';
    const canScroll = scroller.scrollHeight > scroller.clientHeight + 2;
    topFade.style.opacity = (canScroll && scroller.scrollTop > 2) ? '1' : '0';
    botFade.style.opacity = (canScroll && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2) ? '1' : '0';
  };
  scroller.addEventListener('scroll', updateFade, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateFade).observe(scroller);
  requestAnimationFrame(updateFade);
  setTimeout(updateFade, 300);
};
