import { business } from '../content/business'
import { CheckIcon, ClockIcon, ShieldIcon, UsersIcon } from './Icons'

/* The four things an anxious family checks before anything else. Kept directly
   under the hero so none of it needs to be hunted for. */
export default function TrustBar() {
  const items = [
    {
      icon: ShieldIcon,
      label: 'State licensed',
      detail: business.licenceNumber
        ? `${business.licensingBodyShort} · Licence ${business.licenceNumber}`
        : `Inspected and licensed by ${business.licensingBodyShort}`,
    },
    {
      icon: ClockIcon,
      label: 'Awake overnight care',
      detail: 'Staffed 24 hours a day, every day of the year',
    },
    {
      icon: UsersIcon,
      label: 'Small by design',
      detail: business.capacity
        ? `A maximum of ${business.capacity} residents, never more`
        : 'A handful of residents, and the same caregivers each day',
    },
    {
      icon: CheckIcon,
      label: 'Background-checked team',
      detail: 'Every caregiver trained, certified, and known to your family',
    },
  ]

  return (
    <section className="border-y border-sand-deep/40 bg-linen">
      <div className="mx-auto grid max-w-6xl gap-x-8 gap-y-9 px-5 py-12 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:py-14">
        {items.map(({ icon: Icon, label, detail }) => (
          <div key={label} className="flex gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cream text-slate-deep shadow-soft">
              <Icon className="h-[1.35rem] w-[1.35rem]" />
            </span>
            <div>
              <p className="font-semibold text-night">{label}</p>
              <p className="mt-1 text-[0.95rem] leading-snug text-navy-soft">{detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
