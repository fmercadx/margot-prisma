import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'
import WordsPullUpMultiStyle from './WordsPullUpMultiStyle'

const BODY_TEXT =
  'Over the last seven years, I have worked with Parallax, a Berlin-based production house that crafts cinema, series, and Noir Studio in Paris. Together, we have created work that has earned international acclaim at several major festivals.'

interface AnimatedLetterProps {
  char: string
  index: number
  total: number
  progress: MotionValue<number>
}

/* One character, faded from 0.2 to 1 across a narrow slice of the scroll
   range. The slices overlap slightly so the reveal reads as a sweep rather
   than characters popping one at a time. */
function AnimatedLetter({ char, index, total, progress }: AnimatedLetterProps) {
  const charProgress = index / total
  const opacity = useTransform(
    progress,
    [charProgress - 0.1, charProgress + 0.05],
    [0.2, 1],
  )

  return (
    <motion.span style={{ opacity }} className="inline">
      {char}
    </motion.span>
  )
}

export default function About() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.2'],
  })

  const chars = BODY_TEXT.split('')

  return (
    <section className="bg-black px-4 py-20 sm:px-6 sm:py-28 md:py-32">
      <div className="mx-auto max-w-6xl rounded-2xl bg-[#101010] px-5 py-16 text-center sm:px-8 sm:py-20 md:rounded-[2rem] md:px-12 md:py-28">
        <p className="mb-8 text-[10px] uppercase tracking-widest text-primary sm:mb-10 sm:text-xs">
          Visual arts
        </p>

        <WordsPullUpMultiStyle
          className="mx-auto max-w-3xl text-3xl leading-[0.95] sm:text-4xl sm:leading-[0.9] md:text-5xl lg:text-6xl xl:text-7xl"
          segments={[
            { text: 'I am Marcus Chen,', className: 'font-normal' },
            { text: 'a self-taught director.', className: 'italic font-serif' },
            {
              text: 'I have skills in color grading, visual effects, and narrative design.',
              className: 'font-normal',
            },
          ]}
        />

        <div
          ref={ref}
          className="mx-auto mt-12 max-w-2xl text-xs leading-relaxed sm:mt-16 sm:text-sm md:text-base"
          style={{ color: '#DEDBC8' }}
        >
          {chars.map((char, i) => (
            <AnimatedLetter
              key={i}
              char={char}
              index={i}
              total={chars.length}
              progress={scrollYProgress}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
