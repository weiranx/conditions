import { useEffect, useRef } from 'react';

/**
 * Reveal-on-scroll for landing-style pages. Elements marked with
 * [data-reveal] are hidden only after the hook arms the container, so the
 * page stays fully visible without JavaScript. Reduced-motion users never
 * get the armed state, so nothing is ever hidden for them.
 */
export function useScrollReveal<T extends HTMLElement>() {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof IntersectionObserver !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const targets = Array.from(container.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (targets.length === 0) return;

    container.setAttribute('data-reveal-armed', '');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );
    for (const target of targets) observer.observe(target);

    return () => {
      observer.disconnect();
      container.removeAttribute('data-reveal-armed');
    };
  }, []);

  return containerRef;
}
