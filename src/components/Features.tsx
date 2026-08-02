import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import WordsPullUpMultiStyle from './WordsPullUpMultiStyle'

const CARD_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_133058_0504132a-0cf3-4450-a370-8ea3b05c95d4.mp4'

const ICON_STORYBOARD =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171918_4a5edc79-d78f-4637-ac8b-53c43c220606.png&w=1280&q=85'
const ICON_CRITIQUES =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171741_ed9845ab-f5b2-4018-8ce7-07cc01823522.png&w=1280&q=85'
const ICON_CAPSULE =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171809_f56666dc-c099-4778-ad82-9ad4f209567b.png&w=1280&q=85'

const EASE = [0.22, 1, 0.36, 1] as const

interface FeatureCard {
  number: string
  title: string
  icon: string
  items: string[]
}

const CARDS: FeatureCard[] = [
  {
    number: '01',
    title: 'Project Storyboard.',
    icon: ICON_STORYBOARD,
    items: [
      'Sequence shots on a visual timeline',
      'Drop reference frames straight into panels',
      'Version every beat without losing the last cut',
      'Share a read-only board with your client',
    ],
  },
  {
    number: '02',
    title: 'Smart Critiques.',
    icon: ICON_CRITIQUES,
    items: [
      'AI analysis of pacing, framing and colour',
      'Creative notes written against the timecode',
      'Integrations with the tools already in your grade',
    ],
  },
  {
    number: '03',
    title: 'Immersion Capsule.',
    icon: ICON_CAPSULE,
    items: [
      'Notification silencing while a session runs',
      'Ambient soundscapes tuned to the edit',
      'Schedule syncing so the studio knows you are deep',
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
    <section className="relative min-h-screen overflow-hidden bg-black px-4 py-20 sm:px-6 sm:py-28">
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.15]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <WordsPullUpMultiStyle
          className="mx-auto mb-12 max-w-3xl text-center text-xl font-normal sm:mb-16 sm:text-2xl md:text-3xl lg:text-4xl"
          segments={[
            {
              text: 'Studio-grade workflows for visionary creators.',
              className: 'text-primary',
            },
            {
              text: 'Built for pure vision. Powered by art.',
              className: 'text-gray-500',
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-2 md:gap-1 lg:h-[480px] lg:grid-cols-4">
          <AnimatedCard
            index={0}
            className="relative overflow-hidden rounded-2xl bg-[#212121] min-h-[320px] lg:min-h-0"
          >
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src={CARD_VIDEO}
              autoPlay
              loop
              muted
              playsInline
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            <p
              className="absolute bottom-5 left-5 right-5 z-10 text-base sm:text-lg"
              style={{ color: '#E1E0CC' }}
            >
              Your creative canvas.
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
                alt=""
                className="h-10 w-10 rounded-lg object-cover sm:h-12 sm:w-12"
              />

              <h3 className="mt-5 text-base text-primary sm:text-lg">
                {card.title}{' '}
                <span className="text-gray-500">({card.number})</span>
              </h3>

              <ul className="mt-5 flex flex-1 flex-col gap-3">
                {card.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-primary" />
                    <span className="text-xs leading-snug text-gray-400 sm:text-[13px]">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href="#"
                className="group mt-6 inline-flex items-center gap-2 text-xs text-primary transition-colors hover:text-primary/70 sm:text-sm"
              >
                Learn more
                <ArrowRight className="h-3.5 w-3.5 -rotate-45 transition-transform duration-300 group-hover:translate-x-0.5" />
              </a>
            </AnimatedCard>
          ))}
        </div>
      </div>
    </section>
  )
}
