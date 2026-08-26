import { business } from '../content/business'
import Photo from './Photo'
import Reveal from './Reveal'

export default function About() {
  return (
    <section id="about" className="bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
          <Reveal className="order-2 lg:order-1">
            <div className="grid grid-cols-2 gap-4 sm:gap-5">
              <Photo
                name="about-porch"
                caption="The front porch"
                hint="A photo of the entrance as a visitor first sees it."
                className="aspect-[3/4] translate-y-6"
              />
              <Photo
                name="about-hands"
                caption="An unhurried morning"
                hint="A caregiver with a resident — hands, tea, conversation."
                className="aspect-[3/4]"
              />
            </div>
          </Reveal>

          <Reveal className="order-1 lg:order-2" delay={80}>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
              Why families choose a home this size
            </p>
            <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">
              A household, not a facility.
            </h2>

            <div className="mt-6 space-y-5 text-lg text-navy-soft">
              <p>
                Most people arrive here after touring somewhere much larger, and the difference is
                usually obvious within a minute of walking through the door. There is no reception
                desk, no wing, no intercom. It is a house on a residential street, and the people
                who live in it are looked after by caregivers who know them.
              </p>
              <p>
                That scale is the whole point. An Oregon adult foster home is licensed to care
                for five or fewer adults at a time, and when a caregiver has a handful of residents
                rather than a corridor of them, they notice the things that matter early — the appetite that fell off this
                week, the new hesitation on the stairs, the mood that is not quite right. Small
                changes get caught while they are still small.
              </p>
              <p className="font-medium text-navy">
                We named the home {business.name} because good care is quiet. It is not dramatic
                intervention. It is someone paying close attention, every single day.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
