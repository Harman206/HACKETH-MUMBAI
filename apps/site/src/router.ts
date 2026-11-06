import { useEffect, useState } from 'preact/hooks';

/**
 * Page routes live under "#/…" (e.g. #/developers, #/certified/name.eth); any other hash is an anchor on the home page.
 * #/developers/<section> and #/extension/<section> open the page scrolled to that section.
 */
export type Route = { page: 'home' } | { page: 'developers'; section?: string } | { page: 'extension'; section?: string } | { page: 'certified'; name: string | null };

const section = (rest: string[]) => (rest[0] && /^[a-z0-9-]{1,40}$/.test(rest[0]) ? { section: rest[0] } : {});

export function parseRoute(hash: string): Route {
  if (!hash.startsWith('#/')) return { page: 'home' };
  const [page, ...rest] = hash.slice(2).split('/');
  if (page === 'developers') return { page: 'developers', ...section(rest) };
  if (page === 'extension') return { page: 'extension', ...section(rest) };
  if (page === 'certified') return { page: 'certified', name: rest.length ? decodeURIComponent(rest.join('/')).toLowerCase() : null };
  return { page: 'home' };
}

export function useRoute(): Route {
  const [hash, setHash] = useState(typeof location === 'undefined' ? '' : location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const route = parseRoute(hash);
  useEffect(() => {
    // Pages open at the top; an anchor that arrives from another page scrolls once the home page has rendered.
    const target = route.page === 'home' ? (hash.length > 1 ? hash.slice(1) : null) : 'section' in route ? route.section : null;
    if (target) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView());
    else if (route.page !== 'home') window.scrollTo(0, 0);
  }, [hash]);
  return route;
}
