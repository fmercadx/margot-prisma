import { business } from '../content/business'
import { CheckIcon } from './Icons'
import Reveal from './Reveal'

const commitments = [
  'You will hear from us when something changes — a fall, a new medication, a week of poor appetite — the same day, not at the next review.',
  'Visit whenever you like. There are no fixed visiting hours, and you do not need to call ahead.',
  'The rate we quote is the rate you pay. If a resident’s needs change enough to alter it, we discuss it with you before anything is billed.',
  'You may read the state’s inspection reports on our home, and we will hand you a copy ourselves if that is easier.',
  'If this home stops being the right place for your parent, we will say so plainly and help you find the one that is.',
]

export default function Promise() {
  return (
    <section className="bg-navy py-24 text-cream lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <Reveal>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-sand-deep">
              Our commitments
            </p>
            <h2 className="mt-4 text-4xl leading-tight text-cream sm:text-5xl">
              What we promise your family.
            </h2>
            <p className="mt-5 text-lg text-slate-mist">
              Placing a parent in someone else’s care is an act of trust that is difficult to
              justify on a website. These are the five things we hold ourselves to, and you are
              welcome to hold us to them too.
            </p>
          </Reveal>

          <Reveal delay={90}>
            <ul className="space-y-5">
              {commitments.map((line) => (
                <li key={line.slice(0, 30)} className="flex gap-4 border-b border-cream/15 pb-5 last:border-0">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream/15 text-cream">
                    <CheckIcon className="h-4 w-4" />
                  </span>
                  <p className="text-[1.05rem] leading-relaxed text-slate-mist">{line}</p>
                </li>
              ))}
            </ul>
            <p className="mt-8 font-display text-2xl italic text-cream/90">
              — The team at {business.name}
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
