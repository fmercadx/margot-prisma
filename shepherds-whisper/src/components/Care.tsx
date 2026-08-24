import { BowlIcon, ClockIcon, HeartIcon, LeafIcon, PillIcon, ShieldIcon } from './Icons'
import Reveal from './Reveal'

const services = [
  {
    icon: ClockIcon,
    title: 'Licensed 24/7 staffing',
    body: 'Someone is awake and on duty through the night — not sleeping on call. Personal care, bathing, dressing, and transfers are handled by trained caregivers whenever they are needed, not on a schedule that suits the building.',
  },
  {
    icon: PillIcon,
    title: 'Medication management',
    body: 'Every medication is stored securely, given on time, and logged. We coordinate refills with the pharmacy and flag changes to the prescribing provider, so nothing depends on a family member remembering from three towns away.',
  },
  {
    icon: BowlIcon,
    title: 'Home-cooked, adapted meals',
    body: 'Three meals and snacks cooked in the kitchen here, not delivered in trays. Diabetic, low-sodium, soft, and puréed diets are prepared as a matter of routine — and so are the things a resident simply likes.',
  },
  {
    icon: HeartIcon,
    title: 'Memory care and companionship',
    body: 'A calm, predictable rhythm makes an enormous difference to someone living with dementia. Familiar faces, unrushed routines, and redirection rather than correction — from caregivers trained specifically in dementia care.',
  },
  {
    icon: ShieldIcon,
    title: 'Health oversight and coordination',
    body: 'We track vitals, weight, appetite, and mood, and we speak with your parent’s doctor, home-health nurse, and hospice team when one is involved. You get told what changed and when — before it becomes an emergency call.',
  },
  {
    icon: LeafIcon,
    title: 'Daily activity and fresh air',
    body: 'Gardening, music, cards, short walks, church on Sunday, and visits out with family. Engagement is planned around what each resident actually enjoys, which is the only version of it that works.',
  },
]

export default function Care() {
  return (
    <section id="care" className="scroll-mt-24 bg-linen py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
            What is included
          </p>
          <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">
            Everything care actually involves — under one roof, at one price.
          </h2>
          <p className="mt-5 text-lg text-navy-soft">
            There are no à la carte tiers here and no surcharge the month someone needs more help.
            Care changes as a person changes, and the rate is set on what a resident needs when they
            move in.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {services.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 70}>
              <article className="group h-full rounded-4xl border border-sand-deep/50 bg-cream p-7 shadow-soft transition-shadow duration-500 hover:shadow-lift">
                <span className="flex h-14 w-14 items-center justify-center rounded-3xl border border-slate-mist bg-slate-mist/50 text-slate-deep transition-colors duration-500 group-hover:border-slate/40">
                  <Icon className="h-7 w-7" />
                </span>
                <h3 className="mt-6 text-2xl leading-snug">{title}</h3>
                <p className="mt-3 text-[1.02rem] leading-relaxed text-navy-soft">{body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
