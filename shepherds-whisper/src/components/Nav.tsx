import { useEffect, useState } from 'react'
import { business, hasPhone, telHref } from '../content/business'
import { PhoneIcon } from './Icons'

const links = [
  { href: '#about', label: 'Our Home' },
  { href: '#care', label: 'Care' },
  { href: '#team', label: 'The Team' },
  { href: '#tour-gallery', label: 'The House' },
  { href: '#day', label: 'A Day Here' },
  { href: '#faq', label: 'Questions' },
]

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* The mobile sheet is a full-height overlay, so the page underneath must not
     keep scrolling behind it. */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || open ? 'border-b border-sand-deep/40 bg-cream/95 backdrop-blur' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-3 rounded-lg" onClick={() => setOpen(false)}>
          <Mark />
          <span className="leading-tight">
            <span className="block font-display text-lg text-night sm:text-xl">{business.name}</span>
            <span className="block text-[0.72rem] uppercase tracking-[0.18em] text-slate-deep">
              {business.tagline}
            </span>
          </span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded text-[0.95rem] font-medium text-navy transition-colors hover:text-clay"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {hasPhone && (
            <a
              href={telHref(business.phone)}
              className="flex items-center gap-2 rounded-full px-3 py-2 text-[0.95rem] font-semibold text-navy transition-colors hover:text-clay"
            >
              <PhoneIcon className="h-[1.1rem] w-[1.1rem]" />
              {business.phone}
            </a>
          )}
          <a
            href="#tour"
            className="rounded-full bg-navy px-5 py-3 text-[0.95rem] font-semibold text-cream shadow-soft transition-colors hover:bg-night"
          >
            Schedule a Tour
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-sand-deep/60 text-navy md:hidden"
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div id="mobile-menu" className="border-t border-sand-deep/40 bg-cream px-5 pb-8 pt-4 md:hidden">
          <nav aria-label="Primary mobile" className="flex flex-col">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="border-b border-sand-deep/30 py-4 text-lg font-medium text-navy"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-6 flex flex-col gap-3">
            <a
              href="#tour"
              onClick={() => setOpen(false)}
              className="rounded-full bg-navy px-5 py-4 text-center font-semibold text-cream"
            >
              Schedule a Tour
            </a>
            {hasPhone && (
              <a
                href={telHref(business.phone)}
                className="flex items-center justify-center gap-2 rounded-full border border-navy/25 px-5 py-4 font-semibold text-navy"
              >
                <PhoneIcon className="h-5 w-5" />
                {business.phone}
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

/* The shepherd's crook, drawn rather than set in a font so it holds its weight
   at 40px on a phone. */
function Mark() {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-cream">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 21V9.5a4 4 0 1 1 8 0" />
        <path d="M5.5 15.5c1.8 0 2.6-1.2 2.6-2.6" />
      </svg>
    </span>
  )
}
