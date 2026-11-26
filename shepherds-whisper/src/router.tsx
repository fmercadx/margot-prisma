import { useEffect, useState, type ReactNode } from 'react'

/* A router in thirty lines, because the site has exactly two pages.
 *
 * Pulling in a routing library to serve one legal page would add a dependency
 * and a bundle for nothing. server.mjs already falls back to the app shell for
 * any extension-less path, so /privacy reaches this code; the pushState link
 * below keeps it working in the single-file preview build too, where there is
 * no server to do the falling back. */

/* Where the site is mounted: '/' on Railway, '/margot-prisma/shepherds-whisper/'
   on Pages. Vite inlines it at build time from the base above. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

/** '/margot-prisma/shepherds-whisper/privacy' -> '/privacy' */
function toRoute(pathname: string) {
  const stripped = BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname
  return stripped.replace(/\/+$/, '') || '/'
}

/** '/privacy' -> '/margot-prisma/shepherds-whisper/privacy' */
export function href(route: string) {
  return `${BASE}${route}` || '/'
}

export function useRoute() {
  const [path, setPath] = useState(() =>
    typeof window === 'undefined' ? '/' : toRoute(window.location.pathname),
  )

  useEffect(() => {
    const onPop = () => setPath(toRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    window.addEventListener('route', onPop as EventListener)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('route', onPop as EventListener)
    }
  }, [])

  return path
}

export function navigate(to: string) {
  window.history.pushState({}, '', href(to))
  window.dispatchEvent(new Event('route'))
  window.scrollTo({ top: 0 })
}

type RouteLinkProps = { to: string; className?: string; children: ReactNode }

/** A real anchor, so it opens in a new tab and is crawlable, but handled in
 *  the page on a plain click. */
export function RouteLink({ to, className, children }: RouteLinkProps) {
  return (
    <a
      href={href(to)}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
