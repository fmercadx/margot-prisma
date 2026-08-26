import Photo from './Photo'
import Reveal from './Reveal'

/* The grid is sized so that dropping real photographs in changes nothing about
   the layout — each tile already reserves its aspect ratio. */
/* Every tile carries a definite aspect ratio and a definite column span.
 *
 * An earlier version used `auto-rows-fr` with `row-span-2`, which left the
 * large tile's width to be derived from its row height through its
 * aspect-ratio — and that resolved to 583px inside a 350px column, pushing the
 * whole document sideways at phone width. Columns size the tiles here; the
 * aspect ratio only sizes their height. */
const rooms = [
  {
    name: 'private-room',
    caption: 'A private resident room',
    hint: 'Furnished with the resident\u2019s own things \u2014 that is the point of the shot.',
    span: 'sm:col-span-3',
    aspect: 'aspect-[4/5] sm:aspect-[5/4]',
  },
  {
    name: 'living-room',
    caption: 'The living room',
    hint: 'Wide, taken from the doorway.',
    span: 'sm:col-span-3',
    aspect: 'aspect-[4/5] sm:aspect-[5/4]',
  },
  {
    name: 'dining',
    caption: 'Communal dining',
    hint: 'The table set for a meal.',
    span: 'sm:col-span-2',
    aspect: 'aspect-[4/3]',
  },
  {
    name: 'garden',
    caption: 'The garden patio',
    hint: 'Afternoon light, seating visible.',
    span: 'sm:col-span-2',
    aspect: 'aspect-[4/3]',
  },
  {
    name: 'bathroom',
    caption: 'An accessible bathroom',
    hint: 'Show the grab bars and the roll-in shower.',
    span: 'sm:col-span-2',
    aspect: 'aspect-[4/3]',
  },
]

export default function HomeTour() {
  return (
    <section id="tour-gallery" className="scroll-mt-24 bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
            Look around
          </p>
          <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">The house itself.</h2>
          <p className="mt-5 text-lg text-navy-soft">
            Rooms are furnished with residents’ own beds, chairs, quilts and photographs wherever
            possible. Bathrooms are fitted for mobility, doorways take a walker, and there is a
            level way out to the garden.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-6 sm:gap-5">
          {rooms.map((room, i) => (
            <Reveal key={room.name} delay={i * 60} className={`min-w-0 ${room.span}`}>
              <Photo
                name={room.name}
                caption={room.caption}
                hint={room.hint}
                captionBelow
                className={`w-full ${room.aspect}`}
              />
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12 text-center">
          <p className="text-lg text-navy-soft">
            Photographs only go so far.{' '}
            <a href="#tour" className="font-semibold text-slate-deep underline decoration-slate/50 underline-offset-4 hover:text-clay">
              Come and see it in person.
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
