import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import WordsPullUpMultiStyle from './WordsPullUpMultiStyle'

const EASE = [0.22, 1, 0.36, 1] as const

/* lucide-react v1 dropped brand marks, so these two are inline. */
function InstagramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M14.5 8.5h2.5V5h-2.5A4 4 0 0 0 10.5 9v2H8v3.5h2.5V22H14v-7.5h2.6l.4-3.5H14V9.3c0-.5.2-.8.5-.8Z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=6818+NE+Fourth+Plain+Blvd+Vancouver+WA+98661'

export default function Visit() {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section id="visit" className="relative overflow-hidden bg-black px-4 py-20 sm:px-6 sm:py-28">
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.15]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <WordsPullUpMultiStyle
          className="mx-auto mb-12 max-w-3xl text-center text-xl font-normal sm:mb-16 sm:text-2xl md:text-3xl lg:text-4xl"
          segments={[
            { text: 'Come see her.', className: 'text-primary' },
            { text: 'Margot answers the phone herself.', className: 'text-gray-500' },
          ]}
        />

        <div ref={ref} className="grid grid-cols-1 gap-3 sm:gap-2 md:gap-1 lg:grid-cols-3">
          {[
            {
              label: 'Address',
              body: (
                <a
                  href={MAPS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-primary/70"
                >
                  Textures Hair &amp; Nail Salon
                  <br />
                  6818 NE Fourth Plain Blvd.
                  <br />
                  Vancouver, WA 98661
                </a>
              ),
            },
            {
              label: 'Booking & enquiries',
              body: (
                <a
                  href="tel:+13602815853"
                  className="transition-colors hover:text-primary/70"
                >
                  360.281.5853
                </a>
              ),
            },
            {
              label: 'Hours',
              body: (
                <>
                  Monday to Sunday
                  <br />
                  9:00am to 5:00pm
                </>
              ),
            },
          ].map((block, i) => (
            <motion.div
              key={block.label}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={isInView ? { scale: 1, opacity: 1 } : {}}
              transition={{ duration: 0.7, delay: i * 0.15, ease: EASE }}
              className="flex flex-col rounded-2xl bg-[#212121] p-5 sm:p-6"
            >
              <span className="text-[10px] uppercase tracking-widest text-gray-500 sm:text-xs">
                {block.label}
              </span>
              <div
                className="mt-4 text-lg leading-snug sm:text-xl"
                style={{ color: '#E1E0CC' }}
              >
                {block.body}
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-6 sm:mt-14">
          <a
            href="tel:+13602815853"
            className="group inline-flex w-fit items-center gap-2 rounded-full bg-primary py-1.5 pl-5 pr-1.5 text-sm font-medium text-black transition-all duration-300 hover:gap-3 sm:text-base"
          >
            Call 360.281.5853
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black transition-transform duration-300 group-hover:scale-110 sm:h-10 sm:w-10">
              <ArrowRight className="h-4 w-4" style={{ color: '#E1E0CC' }} />
            </span>
          </a>

          <div className="flex items-center gap-3">
            <a
              href="https://www.instagram.com/margotfied/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Margot Trim N Trends on Instagram"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-gray-400 transition-colors hover:border-primary/40 hover:text-primary"
            >
              <InstagramIcon />
            </a>
            <a
              href="https://www.facebook.com/profile.php?id=100011659683011"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Margot Trim N Trends on Facebook"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-gray-400 transition-colors hover:border-primary/40 hover:text-primary"
            >
              <FacebookIcon />
            </a>
          </div>

          <p className="text-center text-[10px] uppercase tracking-widest text-gray-500 sm:text-xs">
            Margot Trim N Trends · Est. 2016 · Vancouver, Washington
          </p>
        </div>
      </div>
    </section>
  )
}
