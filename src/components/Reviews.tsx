import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import WordsPullUpMultiStyle from './WordsPullUpMultiStyle'

const EASE = [0.22, 1, 0.36, 1] as const

interface Review {
  body: string
  name: string
  location: string
  service: string
}

const REVIEWS: Review[] = [
  {
    body: 'Margot is Cinderella’s fairy godmother that uses magic combined with advanced techniques to create flawless haircuts and hairstyles, and glamorous looks for her clients. She is up-to-date with industry trends and has the physical stamina to service all her loyal clientele. I had keratin hair straightening and Brazilian blowout done and I was so impressed with her work.',
    name: 'Rowena CM',
    location: 'Vancouver, WA',
    service: 'Keratin · Brazilian Blowout',
  },
  {
    body: 'I love Margot! She does not disappoint. She did my hair and make up for my wedding, and she delivered! During my wedding, she stayed throughout the day to make sure I looked fabulous! Most recently, I got my eyebrows microbladed by her and I love love the result! Margot is a goddess, an artist, and a professional whose calling is to enhance beauty. I highly recommend this place.',
    name: 'Madel K',
    location: 'Aloha, OR',
    service: 'Bridal · Microblading',
  },
  {
    body: 'Margot is an amazing microblading eyebrow artist! She’s friendly, highly skilled and trained. She also does amazing hair. She dyed my hair and even gave me free color treatment. Customer service was excellent! Ombré Microblading is the new thing! And she did great! Love the work she does!',
    name: 'Dineve R',
    location: 'Beaverton, OR',
    service: 'Microblading · Color',
  },
]

export default function Reviews() {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section id="reviews" className="bg-black px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <WordsPullUpMultiStyle
          className="mx-auto mb-12 max-w-3xl text-center text-xl font-normal sm:mb-16 sm:text-2xl md:text-3xl lg:text-4xl"
          segments={[
            { text: 'A goddess, an artist, a professional.', className: 'text-primary' },
            { text: 'In her clients’ words.', className: 'text-gray-500' },
          ]}
        />

        <div ref={ref} className="grid grid-cols-1 gap-3 sm:gap-2 md:gap-1 lg:grid-cols-3">
          {REVIEWS.map((review, i) => (
            <motion.blockquote
              key={review.name}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={isInView ? { scale: 1, opacity: 1 } : {}}
              transition={{ duration: 0.7, delay: i * 0.15, ease: EASE }}
              className="flex flex-col rounded-2xl bg-[#212121] p-5 sm:p-6"
            >
              <span
                aria-hidden="true"
                className="font-serif text-5xl italic leading-[0.5] text-primary/40"
              >
                &ldquo;
              </span>

              <p className="mt-5 flex-1 text-xs leading-relaxed text-gray-400 sm:text-[13px]">
                {review.body}
              </p>

              <footer className="mt-6 border-t border-white/10 pt-4">
                <span className="block text-[10px] uppercase tracking-widest text-primary sm:text-xs">
                  {review.service}
                </span>
                <span
                  className="mt-2 block text-base sm:text-lg"
                  style={{ color: '#E1E0CC' }}
                >
                  {review.name}
                </span>
                <span className="mt-1 block text-[10px] uppercase tracking-widest text-gray-500 sm:text-xs">
                  {review.location}
                </span>
              </footer>
            </motion.blockquote>
          ))}
        </div>
      </div>
    </section>
  )
}
