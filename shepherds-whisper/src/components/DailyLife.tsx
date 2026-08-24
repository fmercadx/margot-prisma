import Photo from './Photo'
import Reveal from './Reveal'

const schedule = [
  {
    time: 'Morning',
    title: 'Up at your own hour',
    body: 'Nobody is woken to fit a shift change. Help with washing and dressing comes when a resident is ready for it, and breakfast is cooked to order after that.',
  },
  {
    time: 'Midday',
    title: 'The main meal, together',
    body: 'Everyone eats at the same table. It is the busiest, most sociable part of the day, and it is where we notice most of what we need to notice.',
  },
  {
    time: 'Afternoon',
    title: 'Outside, or a good chair',
    body: 'The garden when the weather allows, cards or music when it does not, and a quiet rest for anyone who wants one. Visitors are welcome all afternoon.',
  },
  {
    time: 'Evening',
    title: 'Supper, then settling',
    body: 'A lighter meal, evening medications, and an unhurried bedtime routine. From then until morning, a caregiver is awake in the house.',
  },
]

export default function DailyLife() {
  return (
    <section id="day" className="scroll-mt-24 bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <Reveal>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
              A day here
            </p>
            <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">
              The rhythm of an ordinary day.
            </h2>
            <p className="mt-5 text-lg text-navy-soft">
              Predictability is not the same as regimentation. The shape of the day stays the same,
              which is steadying — especially for someone with memory loss — while the pace inside
              it belongs to each resident.
            </p>

            <Photo
              name="day-dining"
              caption="The dining table at midday"
              hint="A photo of the table laid for the main meal."
              className="mt-9 hidden aspect-[4/3] lg:block"
            />
          </Reveal>

          <Reveal delay={90}>
            <ol className="relative space-y-8 border-l border-sand-deep pl-8 sm:pl-10">
              {schedule.map((item) => (
                <li key={item.time} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[2.53rem] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-sand-deep bg-cream sm:-left-[3.03rem]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-clay" />
                  </span>
                  <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-slate-deep">
                    {item.time}
                  </p>
                  <h3 className="mt-2 text-2xl leading-snug">{item.title}</h3>
                  <p className="mt-2 text-[1.02rem] leading-relaxed text-navy-soft">{item.body}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
