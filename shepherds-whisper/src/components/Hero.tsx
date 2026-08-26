import { business, hasPhone, locality, telHref } from '../content/business'
import { ArrowIcon, PhoneIcon, ShieldIcon } from './Icons'
import Photo from './Photo'

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-cream pt-32 sm:pt-36 lg:pt-40">
      {/* Warm wash behind the headline. Sits under the content and is purely
          decorative, so it is hidden from assistive tech. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-32 -top-24 h-[34rem] w-[34rem] rounded-full bg-sand/50 blur-3xl" />
        <div className="absolute -left-40 top-40 h-[28rem] w-[28rem] rounded-full bg-slate-mist/60 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 pb-20 sm:px-8 lg:pb-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-sand-deep/70 bg-cream/70 px-4 py-2 text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-slate-deep">
              <ShieldIcon className="h-4 w-4" />
              Licensed {business.tagline} · {locality}
            </p>

            <h1 className="mt-7 text-[2.6rem] leading-[1.08] tracking-tight sm:text-6xl lg:text-[4.1rem]">
              Care that feels like
              <span className="block italic text-slate-deep">home, because it is one.</span>
            </h1>

            <p className="mt-7 max-w-prose text-lg text-navy-soft">
              {business.name} is a small licensed home, not a facility. A handful of residents,
              the same familiar caregivers each day, and someone awake and nearby at every hour of
              the night. Your mother or father is known here — their history, their appetite, the
              name of the dog they had in 1974.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="#tour"
                className="group inline-flex items-center justify-center gap-2.5 rounded-full bg-navy px-7 py-4 text-lg font-semibold text-cream shadow-lift transition-colors hover:bg-night"
              >
                Schedule a Tour
                <ArrowIcon className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
              </a>

              {hasPhone ? (
                <a
                  href={telHref(business.phone)}
                  className="inline-flex items-center justify-center gap-2.5 rounded-full border border-navy/25 bg-cream px-7 py-4 text-lg font-semibold text-navy transition-colors hover:border-navy/50"
                >
                  <PhoneIcon className="h-5 w-5" />
                  {business.phone}
                </a>
              ) : (
                <a
                  href="#tour-gallery"
                  className="inline-flex items-center justify-center gap-2.5 rounded-full border border-navy/25 bg-cream px-7 py-4 text-lg font-semibold text-navy transition-colors hover:border-navy/50"
                >
                  See the home
                </a>
              )}
            </div>

            <p className="mt-6 text-[0.95rem] text-navy-soft">
              {business.tourHours} There is never a cost or an obligation to visit.
            </p>
          </div>

          <div className="relative">
            <Photo
              name="hero-living-room"
              caption="The living room, mid-afternoon"
              hint="Replace with a wide, warmly lit photo of the main living space."
              className="aspect-[4/5] w-full"
            />

            {/* Floating card. Hidden below `sm` so it never crowds the photo on
                a narrow phone. */}
            <div className="absolute -bottom-7 -left-4 hidden max-w-[17rem] rounded-3xl border border-sand-deep/50 bg-cream/95 p-5 shadow-lift backdrop-blur sm:block lg:-left-10">
              <p className="font-display text-2xl text-night">Awake, all night</p>
              <p className="mt-1.5 text-[0.95rem] leading-snug text-navy-soft">
                Overnight care here means a caregiver who is up and checking — not one asleep down
                the hall.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
