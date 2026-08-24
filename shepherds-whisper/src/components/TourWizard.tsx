import { useEffect, useId, useRef, useState } from 'react'
import { business, hasPhone, telHref } from '../content/business'
import { ArrowIcon, CalendarIcon, CheckIcon, PhoneIcon, ShieldIcon } from './Icons'
import Reveal from './Reveal'

const CARE_NEEDS = [
  'Mobility assistance',
  'Medication management',
  'Memory care',
  'Bathing and dressing',
  'Incontinence care',
  'Diabetic care',
  'Transfers or a Hoyer lift',
  'Hospice or end-of-life care',
  'Companionship',
  'Still working it out',
] as const

const WINDOWS = ['Morning', 'Midday', 'Afternoon', 'Evening'] as const

const STEPS = ['Your details', 'Care needed', 'Choose a time'] as const

type FormState = {
  name: string
  relationship: string
  phone: string
  email: string
  needs: string[]
  moveIn: string
  date: string
  window: string
  notes: string
}

const EMPTY: FormState = {
  name: '',
  relationship: '',
  phone: '',
  email: '',
  needs: [],
  moveIn: '',
  date: '',
  window: '',
  notes: '',
}

const FORM_ENDPOINT = import.meta.env.VITE_FORM_ENDPOINT ?? ''

/** Local YYYY-MM-DD. `toISOString()` is UTC and shifts the date west of Greenwich. */
function todayISO() {
  const d = new Date()
  const offset = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offset).toISOString().slice(0, 10)
}

function summarise(form: FormState) {
  return [
    `Name: ${form.name}`,
    form.relationship && `Relationship to resident: ${form.relationship}`,
    `Phone: ${form.phone}`,
    form.email && `Email: ${form.email}`,
    '',
    `Care needed: ${form.needs.length ? form.needs.join(', ') : 'Not specified'}`,
    form.moveIn && `Hoping to move in: ${form.moveIn}`,
    '',
    `Preferred tour date: ${form.date || 'Flexible'}`,
    `Preferred time: ${form.window || 'Flexible'}`,
    form.notes && `\nNotes:\n${form.notes}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export default function TourWizard() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const uid = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const isLastStep = step === STEPS.length - 1

  /* Steps are different heights — step two's chips are far taller than step
     three's date field — so advancing can leave a phone looking at whatever
     sits below the form. Pull the top of the form back to just under the
     sticky header on every change but the first paint. */
  const firstPaint = useRef(true)
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false
      return
    }
    const form = formRef.current
    if (!form) return
    const top = form.getBoundingClientRect().top + window.scrollY - 96
    window.scrollTo({
      top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [step])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const toggleNeed = (need: string) =>
    setForm((prev) => ({
      ...prev,
      needs: prev.needs.includes(need)
        ? prev.needs.filter((n) => n !== need)
        : [...prev.needs, need],
    }))

  function validateStepOne() {
    const next: Record<string, string> = {}
    if (!form.name.trim()) next.name = 'Please tell us your name so we know who we are speaking to.'
    if (!form.phone.trim()) next.phone = 'A phone number lets us call you back the same day.'
    else if (form.phone.replace(/\D/g, '').length < 10)
      next.phone = 'That looks a little short — please include the area code.'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      next.email = 'Please check the email address.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function next() {
    if (step === 0 && !validateStepOne()) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault()

    /* Reached by pressing Enter in a field as well as by the button, so an
       early Enter advances the wizard instead of sending a half-filled form. */
    if (step < STEPS.length - 1) {
      next()
      return
    }

    if (!validateStepOne()) {
      setStep(0)
      return
    }

    setStatus('sending')

    if (FORM_ENDPOINT) {
      try {
        const res = await fetch(FORM_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(form),
        })
        setStatus(res.ok ? 'sent' : 'error')
      } catch {
        setStatus('error')
      }
      return
    }

    /* No endpoint configured. Hand the enquiry to the visitor's mail client
       rather than pretending it was delivered — an intake that silently
       disappears is worse than no form at all. */
    if (business.email) {
      const subject = encodeURIComponent(`Tour request — ${form.name}`)
      const body = encodeURIComponent(summarise(form))
      window.location.href = `mailto:${business.email}?subject=${subject}&body=${body}`
    }
    setStatus('sent')
  }

  if (status === 'sent') return <Sent form={form} delivered={Boolean(FORM_ENDPOINT || business.email)} />

  return (
    <section id="tour" className="scroll-mt-24 bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-clay">
              Schedule a tour
            </p>
            <h2 className="mt-4 text-4xl leading-tight sm:text-5xl">
              Come and see the house.
            </h2>
            <p className="mt-5 text-lg text-navy-soft">
              Three short steps. It takes about a minute, and there is no cost and no obligation of
              any kind. We will call you back the same day to confirm.
            </p>

            <div className="mt-8 rounded-3xl border border-slate-mist bg-linen p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cream text-slate-deep shadow-soft">
                <ShieldIcon className="h-5 w-5" />
              </span>
              <p className="mt-4 text-[0.98rem] leading-relaxed text-navy-soft">
                <span className="font-semibold text-night">Your information stays private.</span>{' '}
                What you enter here is used only to arrange your visit and answer your questions. We
                do not sell enquiries, share them with referral agencies, or add you to a mailing
                list.
              </p>
            </div>

            {hasPhone && (
              <p className="mt-6 text-[1.02rem] text-navy-soft">
                Would rather just talk?{' '}
                <a
                  href={telHref(business.phone)}
                  className="font-semibold text-slate-deep underline decoration-slate/50 underline-offset-4 hover:text-clay"
                >
                  Call {business.phone}
                </a>
              </p>
            )}
          </Reveal>

          <Reveal delay={80}>
            <form
              ref={formRef}
              onSubmit={submit}
              noValidate
              className="rounded-4xl border border-sand-deep/50 bg-linen p-6 shadow-lift sm:p-9"
            >
              <Stepper step={step} onJump={(i) => (i < step ? setStep(i) : next())} />

              <div className="mt-8" aria-live="polite">
                {step === 0 && (
                  <fieldset className="space-y-5">
                    <legend className="sr-only">Your details</legend>

                    <Field
                      id={`${uid}-name`}
                      label="Your name"
                      required
                      error={errors.name}
                      value={form.name}
                      autoComplete="name"
                      onChange={(v) => set('name', v)}
                    />

                    <Field
                      id={`${uid}-rel`}
                      label="Your relationship to the person needing care"
                      hint="For example: daughter, son, spouse, case manager."
                      value={form.relationship}
                      onChange={(v) => set('relationship', v)}
                    />

                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field
                        id={`${uid}-phone`}
                        label="Phone"
                        type="tel"
                        required
                        error={errors.phone}
                        value={form.phone}
                        autoComplete="tel"
                        onChange={(v) => set('phone', v)}
                      />
                      <Field
                        id={`${uid}-email`}
                        label="Email"
                        type="email"
                        hint="Optional"
                        error={errors.email}
                        value={form.email}
                        autoComplete="email"
                        onChange={(v) => set('email', v)}
                      />
                    </div>
                  </fieldset>
                )}

                {step === 1 && (
                  <fieldset>
                    <legend className="text-2xl font-semibold text-night">
                      What kind of help is needed?
                    </legend>
                    <p className="mt-2 text-[1.02rem] text-navy-soft">
                      Choose as many as apply, or none — we will go through it properly on the
                      phone. Nothing here is binding.
                    </p>

                    <div className="mt-6 flex flex-wrap gap-2.5">
                      {CARE_NEEDS.map((need) => {
                        const active = form.needs.includes(need)
                        return (
                          <button
                            key={need}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleNeed(need)}
                            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-[0.98rem] font-medium transition-colors ${
                              active
                                ? 'border-navy bg-navy text-cream'
                                : 'border-sand-deep bg-cream text-navy hover:border-slate'
                            }`}
                          >
                            {active && <CheckIcon className="h-4 w-4" />}
                            {need}
                          </button>
                        )
                      })}
                    </div>

                    <div className="mt-7">
                      <span className="block text-[0.95rem] font-semibold text-night">
                        When are you hoping to move in?
                      </span>
                      <div className="mt-3 flex flex-wrap gap-2.5">
                        {['As soon as possible', 'Within a month', 'In a few months', 'Just looking ahead'].map(
                          (option) => (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={form.moveIn === option}
                              onClick={() => set('moveIn', form.moveIn === option ? '' : option)}
                              className={`rounded-full border px-4 py-2.5 text-[0.98rem] font-medium transition-colors ${
                                form.moveIn === option
                                  ? 'border-navy bg-navy text-cream'
                                  : 'border-sand-deep bg-cream text-navy hover:border-slate'
                              }`}
                            >
                              {option}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  </fieldset>
                )}

                {step === 2 && (
                  <fieldset className="space-y-6">
                    <legend className="text-2xl font-semibold text-night">
                      When would suit you?
                    </legend>

                    <div>
                      <label
                        htmlFor={`${uid}-date`}
                        className="block text-[0.95rem] font-semibold text-night"
                      >
                        Preferred date
                      </label>
                      <div className="relative mt-2">
                        <CalendarIcon
                          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-deep"
                        />
                        <input
                          id={`${uid}-date`}
                          type="date"
                          min={todayISO()}
                          value={form.date}
                          onChange={(e) => set('date', e.target.value)}
                          className="w-full rounded-2xl border border-sand-deep bg-cream py-4 pl-12 pr-4 text-lg text-navy shadow-soft"
                        />
                      </div>
                      <p className="mt-2 text-[0.92rem] text-navy-soft">
                        Leave it blank if you are flexible.
                      </p>
                    </div>

                    <div>
                      <span className="block text-[0.95rem] font-semibold text-night">
                        Time of day
                      </span>
                      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        {WINDOWS.map((w) => (
                          <button
                            key={w}
                            type="button"
                            aria-pressed={form.window === w}
                            onClick={() => set('window', form.window === w ? '' : w)}
                            className={`rounded-2xl border px-4 py-3.5 text-[0.98rem] font-medium transition-colors ${
                              form.window === w
                                ? 'border-navy bg-navy text-cream'
                                : 'border-sand-deep bg-cream text-navy hover:border-slate'
                            }`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor={`${uid}-notes`}
                        className="block text-[0.95rem] font-semibold text-night"
                      >
                        Anything you would like us to know
                      </label>
                      <textarea
                        id={`${uid}-notes`}
                        rows={4}
                        value={form.notes}
                        onChange={(e) => set('notes', e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-sand-deep bg-cream px-4 py-3.5 text-lg text-navy shadow-soft"
                        placeholder="Questions, a diagnosis you would like to discuss, or how soon you need to decide."
                      />
                    </div>
                  </fieldset>
                )}
              </div>

              {status === 'error' && (
                <p role="alert" className="mt-6 rounded-2xl bg-clay/10 px-4 py-3 text-[0.98rem] text-clay">
                  Something went wrong sending that.{' '}
                  {hasPhone ? `Please call us on ${business.phone} and we will pick it up straight away.` : 'Please try again in a moment.'}
                </p>
              )}

              <div className="mt-8 flex items-center justify-between gap-4 border-t border-sand-deep/60 pt-6">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="rounded-full px-4 py-3 font-semibold text-navy transition-opacity disabled:invisible"
                >
                  Back
                </button>

                {/* Deliberately always type="button", never type="submit".
                    React reconciles both states onto one DOM node and flushes
                    the click's state update before the browser evaluates the
                    default action — so a node that switches to type="submit"
                    submits the form on the very click that advanced the step.
                    Having no default action to race is the fix. */}
                <button
                  type="button"
                  onClick={() => (isLastStep ? void submit() : next())}
                  disabled={status === 'sending'}
                  className="group inline-flex items-center gap-2.5 rounded-full bg-navy px-7 py-4 text-lg font-semibold text-cream shadow-soft transition-colors hover:bg-night disabled:opacity-70"
                >
                  {isLastStep ? (
                    status === 'sending' ? (
                      'Sending…'
                    ) : (
                      'Request my tour'
                    )
                  ) : (
                    <>
                      Continue
                      <ArrowIcon className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {STEPS.map((label, i) => {
        const done = i < step
        const current = i === step
        return (
          <li key={label} className="flex flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={i > step}
              aria-current={current ? 'step' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[0.95rem] font-semibold transition-colors ${
                  done
                    ? 'border-navy bg-navy text-cream'
                    : current
                      ? 'border-navy bg-cream text-navy'
                      : 'border-sand-deep bg-cream text-navy-soft'
                }`}
              >
                {done ? <CheckIcon className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={`hidden truncate text-[0.95rem] font-medium sm:block ${
                  current ? 'text-night' : 'text-navy-soft'
                }`}
              >
                {label}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

type FieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  hint?: string
  error?: string
  required?: boolean
  autoComplete?: string
}

/* Labels sit above the input, always visible — a floating label that vanishes
   on focus is the wrong pattern for anyone filling this in with reading
   glasses on. */
function Field({ id, label, value, onChange, type = 'text', hint, error, required, autoComplete }: FieldProps) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ')

  return (
    <div>
      <label htmlFor={id} className="block text-[0.95rem] font-semibold text-night">
        {label}
        {required && <span className="ml-1 text-clay">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-2 w-full rounded-2xl border bg-cream px-4 py-4 text-lg text-navy shadow-soft transition-colors ${
          error ? 'border-clay' : 'border-sand-deep focus:border-slate'
        }`}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-2 text-[0.92rem] text-navy-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-[0.92rem] font-medium text-clay">
          {error}
        </p>
      )}
    </div>
  )
}

function Sent({ form, delivered }: { form: FormState; delivered: boolean }) {
  return (
    <section id="tour" className="scroll-mt-24 bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-2xl px-5 text-center sm:px-8">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sage/15 text-sage">
          <CheckIcon className="h-8 w-8" />
        </span>
        <h2 className="mt-7 text-4xl leading-tight sm:text-5xl">
          Thank you{form.name ? `, ${form.name.split(' ')[0]}` : ''}.
        </h2>

        {delivered ? (
          <p className="mt-5 text-lg text-navy-soft">
            Your request is with us. Someone from the home will call you on{' '}
            <span className="font-semibold text-navy">{form.phone}</span> today to confirm a time
            and answer anything you would like to ask before you visit.
          </p>
        ) : (
          <p className="mt-5 text-lg text-navy-soft">
            We have everything we need from this form.
            {hasPhone ? (
              <>
                {' '}
                To lock in a time right now, call us on{' '}
                <a href={telHref(business.phone)} className="font-semibold text-slate-deep underline underline-offset-4">
                  {business.phone}
                </a>
                .
              </>
            ) : null}
          </p>
        )}

        {hasPhone && (
          <a
            href={telHref(business.phone)}
            className="mt-9 inline-flex items-center gap-2.5 rounded-full border border-navy/25 px-7 py-4 text-lg font-semibold text-navy transition-colors hover:border-navy/50"
          >
            <PhoneIcon className="h-5 w-5" />
            {business.phone}
          </a>
        )}
      </div>
    </section>
  )
}
