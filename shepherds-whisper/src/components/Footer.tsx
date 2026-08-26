import { business, hasAddress, hasPhone, locality, telHref } from '../content/business'
import { MailIcon, PhoneIcon, PinIcon } from './Icons'

const year = new Date().getFullYear()

export default function Footer() {
  const { street, city, state, zip } = business.address
  const mapQuery = encodeURIComponent(`${street}, ${city}, ${state} ${zip}`)

  const socials = Object.entries(business.social).filter(([, url]) => url)

  return (
    <footer className="border-t border-sand-deep/50 bg-cream">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-16">
          <div>
            <p className="font-display text-3xl text-night">{business.name}</p>
            <p className="mt-1 text-[0.78rem] uppercase tracking-[0.18em] text-slate-deep">
              {business.tagline} · {locality}
            </p>
            <p className="mt-5 max-w-sm text-[1.02rem] leading-relaxed text-navy-soft">
              A small licensed home providing 24-hour personal care for older adults and adults
              living with disabilities.
            </p>

            <a
              href="#tour"
              className="mt-7 inline-flex rounded-full bg-navy px-6 py-3.5 font-semibold text-cream transition-colors hover:bg-night"
            >
              Schedule a Tour
            </a>
          </div>

          <div>
            <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-slate-deep">
              Get in touch
            </h2>
            <ul className="mt-5 space-y-4 text-[1.02rem]">
              {hasPhone && (
                <li>
                  <a href={telHref(business.phone)} className="flex items-start gap-3 text-navy hover:text-clay">
                    <PhoneIcon className="mt-1 h-5 w-5 shrink-0 text-slate-deep" />
                    <span className="font-semibold">{business.phone}</span>
                  </a>
                </li>
              )}
              {business.email && (
                <li>
                  <a href={`mailto:${business.email}`} className="flex items-start gap-3 text-navy hover:text-clay">
                    <MailIcon className="mt-1 h-5 w-5 shrink-0 text-slate-deep" />
                    <span className="break-all">{business.email}</span>
                  </a>
                </li>
              )}
              {hasAddress && (
                <li>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 text-navy hover:text-clay"
                  >
                    <PinIcon className="mt-1 h-5 w-5 shrink-0 text-slate-deep" />
                    <span>
                      {street}
                      <br />
                      {city}, {state} {zip}
                    </span>
                  </a>
                </li>
              )}
            </ul>
            <p className="mt-5 text-[0.95rem] text-navy-soft">{business.hours}</p>
          </div>

          <div>
            <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-slate-deep">
              Licensing
            </h2>
            <p className="mt-5 text-[1.02rem] leading-relaxed text-navy-soft">
              Licensed and inspected by the {business.licensingBody}.
              {business.licenceNumber && (
                <>
                  {' '}
                  Licence <span className="font-semibold text-navy">{business.licenceNumber}</span>.
                </>
              )}
            </p>
            <a
              href={business.licensingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[1.02rem] font-semibold text-slate-deep underline decoration-slate/50 underline-offset-4 hover:text-clay"
            >
              Look up our inspection record
            </a>

            {socials.length > 0 && (
              <ul className="mt-7 flex gap-3">
                {socials.map(([name, url]) => (
                  <li key={name}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-full border border-sand-deep px-4 py-2 text-[0.95rem] font-medium capitalize text-navy hover:border-slate"
                    >
                      {name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-sand-deep/50 pt-8 text-[0.92rem] text-navy-soft sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {business.legalName}. All rights reserved.
          </p>
          <p>
            We provide equal access to housing and care regardless of race, colour, national origin,
            religion, sex, familial status, or disability.
          </p>
        </div>
      </div>
    </footer>
  )
}
