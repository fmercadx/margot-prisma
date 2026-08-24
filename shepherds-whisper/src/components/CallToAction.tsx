import { business, hasPhone, telHref } from '../content/business'
import { ArrowIcon, PhoneIcon } from './Icons'
import Reveal from './Reveal'

export default function CallToAction() {
  return (
    <section className="bg-cream pb-24 lg:pb-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-5xl border border-sand-deep/60 bg-linen px-6 py-16 text-center sm:px-14 lg:py-20">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-sand/60 blur-3xl" />
              <div className="absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-slate-mist/70 blur-3xl" />
            </div>

            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-4xl leading-tight sm:text-5xl">
                You do not have to decide today.
              </h2>
              <p className="mt-5 text-lg text-navy-soft">
                Most families visit two or three homes before anything feels right, and that is
                exactly as it should be. Come and look at ours — ask hard questions, meet the people
                who would be caring for your parent, and see how the house feels on an ordinary
                afternoon.
              </p>

              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <a
                  href="#tour"
                  className="group inline-flex items-center justify-center gap-2.5 rounded-full bg-navy px-7 py-4 text-lg font-semibold text-cream shadow-lift transition-colors hover:bg-night"
                >
                  Schedule a Tour
                  <ArrowIcon className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
                </a>
                {hasPhone && (
                  <a
                    href={telHref(business.phone)}
                    className="inline-flex items-center justify-center gap-2.5 rounded-full border border-navy/25 bg-cream px-7 py-4 text-lg font-semibold text-navy transition-colors hover:border-navy/50"
                  >
                    <PhoneIcon className="h-5 w-5" />
                    {business.phone}
                  </a>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
