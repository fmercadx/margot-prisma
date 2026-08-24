import { testimonials } from '../content/testimonials'
import { QuoteIcon } from './Icons'
import Reveal from './Reveal'

export default function Testimonials() {
  /* Nothing renders until real, permitted quotes exist. See the note in
     `src/content/testimonials.ts` for why this is not a placeholder to fill
     with plausible-sounding filler. */
  if (testimonials.length === 0) return null

  return (
    <section id="families" className="scroll-mt-24 bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
            From families
          </p>
          <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">In their words.</h2>
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {testimonials.map((t, i) => (
            <Reveal key={t.quote.slice(0, 40)} delay={i * 70}>
              <figure className="flex h-full flex-col rounded-4xl border border-sand-deep/50 bg-linen p-7 shadow-soft">
                <QuoteIcon className="h-6 w-8 text-sand-deep" />
                <blockquote className="mt-5 flex-1 text-[1.05rem] leading-relaxed text-navy">
                  {t.quote}
                </blockquote>
                <figcaption className="mt-6 border-t border-sand-deep/60 pt-4 text-[0.95rem]">
                  <span className="font-semibold text-night">{t.attribution}</span>
                  {t.source && <span className="block text-navy-soft">{t.source}</span>}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
