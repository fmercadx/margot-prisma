import { useState } from 'react'
import { business, hasPhone, telHref } from '../content/business'
import { ChevronIcon } from './Icons'
import Reveal from './Reveal'

/* Written to answer the question actually being asked, including the ones
   families feel awkward raising on a first call — cost, and what happens when
   someone declines. */
const faqs = [
  {
    q: 'What is an adult family home, and how is it different from assisted living?',
    a: `An adult family home is a licensed private residence where a small number of adults live and receive care. State rules cap it at six residents, which is the essential difference: assisted living communities house dozens to hundreds of people, with staff rotating across a building. Here, the same few caregivers look after the same few residents in an ordinary house, and the ratio is a fraction of what it is anywhere larger.`,
  },
  {
    q: 'Are you licensed and inspected?',
    a: `Yes. ${business.name} is licensed by the ${business.licensingBody}, which inspects homes, investigates complaints, and publishes the results publicly.${business.licenceNumber ? ` Our licence number is ${business.licenceNumber}.` : ''} You can look up any home's inspection history on the state's website before you visit, and we would encourage you to.`,
  },
  {
    q: 'How much does it cost?',
    a: `Rates depend on the level of care a resident needs, so we quote after we have met them — a flat number on a website would be a guess. What we can tell you is how it is structured: one monthly rate that covers the room, all meals, and all personal care, with no separate charges for medication management, incontinence supplies, or "care levels" that climb over time. We put the figure in writing before anyone commits to anything.`,
  },
  {
    q: 'Do you accept Medicaid, or is this private pay only?',
    a: `Ask us directly, because the answer depends on our current resident mix and on what our contract allows at the time. Some adult family homes take Medicaid from day one, some accept it only after a period of private pay, and some are private pay only. We will tell you plainly where we stand rather than let you find out at the point of application. If we cannot take your situation, we will say so on the first call.`,
  },
  {
    q: 'Can we visit whenever we want?',
    a: `Yes. There are no fixed visiting hours and you do not need to call ahead. This is your parent's home, and you are family — come at breakfast, take them out for the afternoon, stay for supper. The only thing we ask is that you let us know if you are taking a resident off the property so that medications go with them.`,
  },
  {
    q: 'Who handles medical care and doctor visits?',
    a: `Residents keep their own doctors. We manage and administer medications, monitor day-to-day health, and coordinate with the physician, home-health nurse, physical therapist, or hospice team involved. We arrange transport to appointments and can accompany a resident when family cannot. If something changes, the family and the provider hear from us the same day.`,
  },
  {
    q: 'What happens if my parent needs more care later, or needs hospice?',
    a: `Most residents stay. We are set up for care needs that increase over time, including hospice at the end of life, working alongside a hospice team in the home so that nobody has to move somewhere unfamiliar in their last weeks. If a resident ever develops needs beyond what we can safely meet, we will tell you early and help you find the right place — we will not simply give notice.`,
  },
  {
    q: 'What is the process for moving in?',
    a: `A visit first, with no obligation. If it feels right, we assess your parent's care needs in person, agree the rate in writing, and complete the state's required admission paperwork and a negotiated care plan. Move-in can happen quickly when it needs to — we have taken residents straight from a hospital discharge — but nobody is rushed.`,
  },
  {
    q: 'Can my parent bring their own furniture?',
    a: `Please do. Their own bed, chair, quilt, pictures on the wall, and the clock they have wound for forty years. A room that looks like theirs settles someone far faster than a room that looks like a room, and for a resident with memory loss the difference can be considerable.`,
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faq" className="scroll-mt-24 bg-linen py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
              Questions families ask
            </p>
            <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">
              The things you would rather not have to ask.
            </h2>
            <p className="mt-5 text-lg text-navy-soft">
              Cost, licensing, and what happens when things get harder. None of it is awkward to us
              — it is what we would want to know too.
            </p>
            {hasPhone && (
              <p className="mt-6 text-[1.02rem] text-navy-soft">
                Not answered here?{' '}
                <a
                  href={telHref(business.phone)}
                  className="font-semibold text-slate-deep underline decoration-slate/50 underline-offset-4 hover:text-clay"
                >
                  Call {business.phone}
                </a>{' '}
                and ask.
              </p>
            )}
          </Reveal>

          <Reveal delay={80}>
            <div className="divide-y divide-sand-deep/70 border-y border-sand-deep/70">
              {faqs.map((faq, i) => {
                const expanded = open === i
                return (
                  <div key={faq.q}>
                    <h3>
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : i)}
                        aria-expanded={expanded}
                        aria-controls={`faq-panel-${i}`}
                        id={`faq-trigger-${i}`}
                        className="flex w-full items-start justify-between gap-5 py-6 text-left"
                      >
                        <span className="font-display text-xl leading-snug text-night sm:text-2xl">
                          {faq.q}
                        </span>
                        <span
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sand-deep bg-cream text-slate-deep transition-transform duration-300 ${
                            expanded ? 'rotate-180' : ''
                          }`}
                        >
                          <ChevronIcon className="h-4 w-4" />
                        </span>
                      </button>
                    </h3>
                    <div
                      id={`faq-panel-${i}`}
                      role="region"
                      aria-labelledby={`faq-trigger-${i}`}
                      hidden={!expanded}
                      className="pb-7 pr-12"
                    >
                      <p className="max-w-prose text-[1.05rem] leading-relaxed text-navy-soft">
                        {faq.a}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
