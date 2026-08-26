import { caregivers, type Caregiver } from '../content/caregivers'
import { business } from '../content/business'
import { photos } from '../photos'
import { CheckIcon, ClockIcon, HeartIcon, ShieldIcon, UsersIcon } from './Icons'
import Reveal from './Reveal'

/* What every caregiver here is held to.
 *
 * These four are safe to state before a single profile exists, because three of
 * them are conditions of holding the licence at all — Oregon will not license a
 * home whose staff are not cleared and trained — and the fourth is how this home
 * chooses to roster. None of them is a claim about a particular person. */
const standards = [
  {
    icon: ShieldIcon,
    title: 'Cleared before the first shift',
    body: `Everyone who works in this home is checked through the ${business.licensingBodyShort} background check process before they care for a resident. It is a condition of our licence, not a courtesy.`,
  },
  {
    icon: CheckIcon,
    title: 'Trained before working alone',
    body: 'Caregivers complete the training the state requires — including first aid and CPR — and nobody takes a shift on their own here until they have worked alongside someone experienced for as long as it takes.',
  },
  {
    icon: UsersIcon,
    title: 'The same faces, on purpose',
    body: 'Caregivers are assigned to the same residents rather than rotated. It is how someone notices that a person is quieter than usual, or eating less, in the first week rather than the third.',
  },
  {
    icon: ClockIcon,
    title: 'Awake through the night',
    body: 'Overnight cover means a caregiver who is up and checking. Nobody here is left waiting until morning because the person on duty was asleep.',
  },
]

export default function Caregivers() {
  const hasProfiles = caregivers.length > 0

  return (
    <section id="team" className="scroll-mt-24 bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
            The people here
          </p>
          <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">
            Who will actually be looking after your mother.
          </h2>
          <p className="mt-5 text-lg text-navy-soft">
            In a home this size the answer is a handful of people, and you will meet all of them.
            That is worth more than any credential on a wall — you get to judge for yourself how
            they speak to the residents who already live here.
          </p>
        </Reveal>

        {hasProfiles && (
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
            {caregivers.map((person, i) => (
              <Reveal key={person.name} delay={i * 70}>
                <CaregiverCard person={person} />
              </Reveal>
            ))}
          </div>
        )}

        <div className={hasProfiles ? 'mt-16' : 'mt-14'}>
          {hasProfiles && (
            <Reveal>
              <h3 className="text-2xl leading-snug">What every one of them is held to</h3>
            </Reveal>
          )}

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:gap-6">
            {standards.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 70}>
                <article className="flex h-full gap-5 rounded-4xl border border-sand-deep/50 bg-linen p-7">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-mist bg-cream text-slate-deep shadow-soft">
                    <Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <h4 className="text-xl leading-snug text-night">{title}</h4>
                    <p className="mt-2 text-[1.02rem] leading-relaxed text-navy-soft">{body}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>

        {!hasProfiles && (
          <Reveal className="mt-10">
            <p className="max-w-prose text-lg text-navy-soft">
              We would rather introduce our caregivers in person than in a photograph.{' '}
              <a
                href="#tour"
                className="font-semibold text-slate-deep underline decoration-slate/50 underline-offset-4 hover:text-clay"
              >
                Come and meet them.
              </a>
            </p>
          </Reveal>
        )}
      </div>
    </section>
  )
}

function CaregiverCard({ person }: { person: Caregiver }) {
  const portrait = person.photo ? photos[person.photo] : undefined

  return (
    <article className="flex h-full flex-col rounded-4xl border border-sand-deep/50 bg-linen p-7 shadow-soft">
      <div className="flex items-center gap-4">
        {portrait ? (
          <img
            src={portrait}
            alt={person.name}
            loading="lazy"
            decoding="async"
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <Monogram name={person.name} />
        )}
        <div className="min-w-0">
          <h3 className="truncate font-display text-2xl leading-snug text-night">{person.name}</h3>
          <p className="text-[0.95rem] font-medium text-slate-deep">{person.role}</p>
        </div>
      </div>

      <p className="mt-5 flex-1 text-[1.02rem] leading-relaxed text-navy-soft">{person.bio}</p>

      {person.tenure && (
        <p className="mt-5 flex items-center gap-2 border-t border-sand-deep/60 pt-4 text-[0.95rem] text-navy-soft">
          <HeartIcon className="h-[1.05rem] w-[1.05rem] shrink-0 text-clay" />
          {person.tenure}
        </p>
      )}
    </article>
  )
}

/* Initials, for a caregiver with no portrait. A monogram reads as a choice; an
   empty avatar frame reads as a missing file. */
function Monogram({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <span
      aria-hidden
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-mist font-display text-xl text-slate-deep"
    >
      {initials}
    </span>
  )
}
