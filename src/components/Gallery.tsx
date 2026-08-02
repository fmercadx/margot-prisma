import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import WordsPullUpMultiStyle from './WordsPullUpMultiStyle'

const EASE = [0.22, 1, 0.36, 1] as const

const PLATES = [
  { src: '/img/hero-blonde-balayage.jpg', alt: 'Long blonde balayage worn sleek and straight', caption: 'Balayage · Keratin finish' },
  { src: '/img/keratin-sleek.jpg', alt: 'Glossy, poker-straight dark hair after a keratin treatment', caption: 'Keratin smoothing' },
  { src: '/img/color-foils.jpg', alt: 'Balayage colour being hand painted onto a section of hair', caption: 'Dimensional colour' },
  { src: '/img/brows-groomed.jpg', alt: 'A softly shaped, naturally defined eyebrow', caption: 'Powder brows' },
  { src: '/img/makeup-eye.jpg', alt: 'Eye makeup finished with a precise winged liner', caption: 'Bridal makeup' },
  { src: '/img/styling-waves.jpg', alt: 'Soft waves being shaped with a curling wand', caption: 'Waves & styling' },
  { src: '/img/cut-shears.jpg', alt: 'Hairdressing shears resting in dramatic window light', caption: 'Precision cutting' },
  { src: '/img/blowout-brush.jpg', alt: 'A round brush smoothing blonde hair through a blow-dry', caption: 'Brazilian blowout' },
]

export default function Gallery() {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section id="gallery" className="bg-black px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <WordsPullUpMultiStyle
          className="mx-auto mb-12 max-w-3xl text-center text-xl font-normal sm:mb-16 sm:text-2xl md:text-3xl lg:text-4xl"
          segments={[
            { text: 'The proof is in the mirror.', className: 'text-primary' },
            { text: 'Recent work from the chair.', className: 'text-gray-500' },
          ]}
        />

        {/* Horizontal rail on every breakpoint. A grid would crop these to a
            uniform ratio and the portrait shots are the point. */}
        <div
          ref={ref}
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-4 sm:gap-3"
        >
          {PLATES.map((plate, i) => (
            <motion.figure
              key={plate.src}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={isInView ? { scale: 1, opacity: 1 } : {}}
              transition={{ duration: 0.7, delay: i * 0.08, ease: EASE }}
              className="group w-[230px] flex-none snap-start sm:w-[280px] lg:w-[320px]"
            >
              <div className="overflow-hidden rounded-2xl bg-[#212121]">
                <img
                  src={plate.src}
                  alt={plate.alt}
                  loading="lazy"
                  className="aspect-[3/4] w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
              </div>
              <figcaption className="mt-3 text-[10px] uppercase tracking-widest text-gray-500 sm:text-xs">
                {plate.caption}
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  )
}
