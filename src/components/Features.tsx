import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import WordsPullUpMultiStyle from './WordsPullUpMultiStyle'

const EASE = [0.22, 1, 0.36, 1] as const

interface ServiceItem {
  name: string
  price: string
}

interface ServiceCard {
  number: string
  title: string
  icon: string
  iconAlt: string
  items: ServiceItem[]
}

const CARDS: ServiceCard[] = [
  {
    number: '01',
    title: 'Smoothing.',
    icon: '/img/keratin-sleek.jpg',
    iconAlt: 'Glossy, poker-straight dark hair after a keratin smoothing treatment',
    items: [
      { name: 'Keratin hair straightening', price: '$250 to $400' },
      { name: 'Brazilian blowout', price: 'From $200' },
      { name: 'Semi-permanent straightening', price: 'On request' },
    ],
  },
  {
    number: '02',
    title: 'Colour & Cutting.',
    icon: '/img/color-foils.jpg',
    iconAlt: 'Balayage colour being hand painted onto a section of hair',
    items: [
      { name: 'Balayage', price: 'From $250' },
      { name: 'All-over colour', price: 'From $100' },
      { name: 'Highlights, full head', price: 'From $200' },
      { name: "Women's cut & style", price: '$45 to $70' },
      { name: "Men's cut & style", price: '$35' },
    ],
  },
  {
    number: '03',
    title: 'Brows & Makeup.',
    icon: '/img/brows-groomed.jpg',
    iconAlt: 'A softly shaped, naturally defined eyebrow in close detail',
    items: [
      { name: 'Powder brows, microblading', price: '$350' },
      { name: 'Ombré brows', price: '$550' },
      { name: 'Makeup application', price: '$100' },
      { name: 'Bridal hair & makeup', price: 'On request' },
    ],
  },
]

/* Wraps each card so the entrance animation can be staggered by index while
   each card still fires on its own viewport entry. */
function AnimatedCard({
  index,
  className,
  children,
}: {
  index: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <motion.div
      ref={ref}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={isInView ? { scale: 1, opacity: 1 } : {}}
      transition={{ duration: 0.7, delay: index * 0.15, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export default function Features() {
  return (
    <section
      id="services"
      className="relative min-h-screen overflow-hidden bg-black px-4 py-20 sm:px-6 sm:py-28"
    >
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.15]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <WordsPullUpMultiStyle
          className="mx-auto mb-12 max-w-3xl text-center text-xl font-normal sm:mb-16 sm:text-2xl md:text-3xl lg:text-4xl"
          segments={[
            {
              text: 'Twenty years of hair artistry, in one chair.',
              className: 'text-primary',
            },
            {
              text: 'Every price published. Ranges reflect length and density.',
              className: 'text-gray-500',
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-2 md:gap-1 lg:h-[480px] lg:grid-cols-4">
          <AnimatedCard
            index={0}
            className="relative min-h-[320px] overflow-hidden rounded-2xl bg-[#212121] lg:min-h-0"
          >
            <img
              src="/img/hair-waves.jpg"
              alt="Close detail of soft, dimensional blonde waves"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <p
              className="absolute bottom-5 left-5 right-5 z-10 text-base sm:text-lg"
              style={{ color: '#E1E0CC' }}
            >
              Your crowning glory.
            </p>
          </AnimatedCard>

          {CARDS.map((card, i) => (
            <AnimatedCard
              key={card.number}
              index={i + 1}
              className="flex flex-col rounded-2xl bg-[#212121] p-5 sm:p-6"
            >
              <img
                src={card.icon}
                alt={card.iconAlt}
                className="h-10 w-10 rounded-lg object-cover sm:h-12 sm:w-12"
              />

              <h3 className="mt-5 text-base text-primary sm:text-lg">
                {card.title} <span className="text-gray-500">({card.number})</span>
              </h3>

              <ul className="mt-5 flex flex-1 flex-col gap-3">
                {card.items.map((item) => (
                  <li key={item.name} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-primary" />
                    <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs leading-snug sm:text-[13px]">
                      <span className="text-gray-400">{item.name}</span>
                      <span className="whitespace-nowrap text-primary/80">
                        {item.price}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href="tel:+13602815853"
                className="group mt-6 inline-flex items-center gap-2 text-xs text-primary transition-colors hover:text-primary/70 sm:text-sm"
              >
                Book this
                <ArrowRight className="h-3.5 w-3.5 -rotate-45 transition-transform duration-300 group-hover:translate-x-0.5" />
              </a>
            </AnimatedCard>
          ))}
        </div>
      </div>
    </section>
  )
}
