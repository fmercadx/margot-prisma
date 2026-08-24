import About from './components/About'
import CallToAction from './components/CallToAction'
import Care from './components/Care'
import DailyLife from './components/DailyLife'
import FAQ from './components/FAQ'
import Footer from './components/Footer'
import Hero from './components/Hero'
import HomeTour from './components/HomeTour'
import Nav from './components/Nav'
import Promise from './components/Promise'
import Testimonials from './components/Testimonials'
import TourWizard from './components/TourWizard'
import TrustBar from './components/TrustBar'

export default function App() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-navy focus:px-5 focus:py-3 focus:font-semibold focus:text-cream"
      >
        Skip to content
      </a>

      <Nav />

      <main id="main">
        <Hero />
        <TrustBar />
        <About />
        <Care />
        <DailyLife />
        <HomeTour />
        <Promise />
        <Testimonials />
        <TourWizard />
        <FAQ />
        <CallToAction />
      </main>

      <Footer />
    </>
  )
}
