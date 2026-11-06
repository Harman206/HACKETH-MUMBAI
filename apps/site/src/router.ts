import { useEffect, useState } from 'preact/hooks';

/** Page routes live under "#/…" (e.g. #/developers, #/certified/name.eth, #/docs/cli/flags); any other hash is an anchor on the home page. */
export type Route =
  | { page: 'home' }
  | { page: 'developers' }
  | { page: 'extension' }
  | { page: 'certified'; name: string | null }
  | { page: 'docs'; slug: string | null; anchor: string | null };

export function parseRoute(hash: string): Route {
  if (!hash.startsWith('#/')) return { page: 'home' };
  const [page, ...rest] = hash.slice(2).split('/');
  if (page === 'developers') return { page: 'developers' };
  if (page === 'extension') return { page: 'extension' };
  if (page === 'certified') return { page: 'certified', name: rest.length ? decodeURIComponent(rest.join('/')).toLowerCase() : null };
  if (page === 'docs') return { page: 'docs', slug: rest[0] || null, anchor: rest[1] || null };
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
    // Pages open at the top; an anchor (home section or docs heading) scrolls once its page has rendered.
    if (route.page === 'docs' && route.anchor) document.getElementById(route.anchor)?.scrollIntoView();
    else if (route.page !== 'home') window.scrollTo(0, 0);
    else if (hash.length > 1) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return route;
}
