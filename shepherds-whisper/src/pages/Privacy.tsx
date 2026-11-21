import { business, hasAddress, hasPhone, telHref } from '../content/business'
import { navigate, RouteLink } from '../router'

/* ---------------------------------------------------------------------------
 * Every claim on this page was read off the code, not off a template.
 *
 *   - no cookies / storage / analytics  -> grep of src + index.html, zero hits
 *   - Google Fonts is the only off-site request the page makes
 *   - the form's fields               -> EMPTY in TourWizard.tsx
 *   - Resend, reply_to, the IP window -> tour-request.mjs
 *   - the deploy-log fallback         -> the 502 path in handleTourRequest
 *
 * If any of those change, this page is wrong until it is changed too. The
 * deploy-log paragraph in particular exists because the server really does
 * write a failed enquiry to the hosting logs, and a policy that omitted it
 * would be false in the one case a family would most want to know about.
 * ------------------------------------------------------------------------- */

/** The date the policy takes effect. Blank until the operator sets it. */
const EFFECTIVE_DATE = ''

/** Where privacy questions go. Falls back to the phone when unset. */
const PRIVACY_EMAIL = business.email

const Todo = ({ children }: { children: string }) => (
  <span className="rounded bg-clay/15 px-1.5 py-0.5 font-semibold text-clay">[{children}]</span>
)

const CARE_NEEDS_SHOWN = [
  'mobility assistance',
  'medication management',
  'memory care',
  'bathing and dressing',
  'incontinence care',
  'diabetic care',
  'transfers or a Hoyer lift',
  'hospice or end-of-life care',
  'companionship',
]

export default function Privacy() {
  const inEffect = EFFECTIVE_DATE.length > 0

  return (
    <main className="bg-cream pb-24 pt-32 sm:pt-36">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <RouteLink
          to="/"
          className="inline-flex items-center gap-2 text-[0.95rem] font-semibold text-slate-deep hover:text-clay"
        >
          <span aria-hidden>←</span> Back to {business.name}
        </RouteLink>

        <h1 className="mt-8 text-4xl leading-tight sm:text-5xl">Privacy</h1>

        <p className="mt-4 text-[0.95rem] text-navy-soft">
          {inEffect ? (
            <>In effect from {EFFECTIVE_DATE}.</>
          ) : (
            <>
              Effective date: <Todo>not yet set</Todo>
            </>
          )}{' '}
          Applies to this website and to asking us for a tour.
        </p>

        {!inEffect && (
          <p className="mt-6 rounded-2xl border border-clay/40 bg-clay/10 px-5 py-4 text-[1.02rem] text-navy">
            <span className="font-semibold">This policy is not yet in effect.</span> It describes
            what the site does today, but it has no effective date and no privacy contact address
            on it. Both need filling in before it is relied on.
          </p>
        )}

        {/* The summary earns its place: most people read this far and no further. */}
        <div className="mt-10 rounded-4xl border border-sand-deep/60 bg-linen p-7">
          <h2 className="text-2xl leading-snug">The short version</h2>
          <ul className="mt-4 space-y-3 text-[1.05rem] leading-relaxed text-navy-soft">
            <li>Reading this site is anonymous. No account, no cookies, no analytics, no tracking.</li>
            <li>
              If you fill in the tour form, what you type is emailed to us and nowhere else. We do
              not sell it, pass it to referral agencies, or put you on a mailing list.
            </li>
            <li>
              The form asks about care needs, which is health information about a real person. Only
              send what you are comfortable sending — you can call instead and tell us nothing in
              writing at all.
            </li>
            <li>Ask us what we hold about you, or ask us to delete it, and we will.</li>
          </ul>
        </div>

        <Section title="Who this is from">
          <p>
            {business.legalName}
            {hasAddress && (
              <>
                , {business.address.street}, {business.address.city}, {business.address.state}{' '}
                {business.address.zip}
              </>
            )}
            . We run a licensed adult foster home and this is our own website. Nobody else operates
            it or advertises on it.
          </p>
        </Section>

        <Section title="Reading the site">
          <p>
            We collect nothing when you browse. There is no account to make, no cookie set, no
            analytics script, no advertising pixel, and no third party watching which pages you
            read or how long you stay.
          </p>
          <p>
            There is one exception, and it is worth naming plainly: the page loads its typefaces
            from Google Fonts. Your browser therefore makes a request to{' '}
            <span className="font-medium text-navy">fonts.googleapis.com</span> and{' '}
            <span className="font-medium text-navy">fonts.gstatic.com</span>, and Google receives
            your IP address as a result, under its own privacy policy rather than ours. Nothing
            about your visit is sent with it, and we receive nothing back.
          </p>
          <p>
            Our web host records ordinary server logs — the kind every web server keeps — which
            include IP addresses and the pages requested. We do not use them to build any picture
            of individual visitors.
          </p>
        </Section>

        <Section title="Asking for a tour">
          <p>The tour form asks for:</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>your name, and how you are related to the person needing care</li>
            <li>your phone number, and your email address if you give one</li>
            <li>
              the kinds of care needed, chosen from a fixed list — {CARE_NEEDS_SHOWN.join(', ')}
            </li>
            <li>roughly when you hope someone might move in</li>
            <li>a preferred day and time for the visit</li>
            <li>anything else you choose to type in the notes box</li>
          </ul>
          <p>
            Some of that is health information about a named person, usually not you. We ask for it
            because we cannot tell you honestly whether this home suits your parent without it.{' '}
            <span className="font-medium text-navy">
              None of it is required to speak to us.
            </span>{' '}
            {hasPhone ? (
              <>
                Call{' '}
                <a
                  href={telHref(business.phone)}
                  className="font-semibold text-slate-deep underline underline-offset-4 hover:text-clay"
                >
                  {business.phone}
                </a>{' '}
                and tell us as much or as little as you like.
              </>
            ) : (
              <>Telephone us instead and tell us as much or as little as you like.</>
            )}
          </p>
        </Section>

        <Section title="Where it goes">
          <p>
            What you submit is sent to this website's own server and immediately emailed to the
            home. We use <span className="font-medium text-navy">Resend</span> to deliver that one
            email; it passes through their systems in transit, under their own privacy policy. It
            is not stored in any database, customer system, or enquiry platform. There is no CRM
            here.
          </p>
          <p>
            If you gave an email address, it is set as the reply address on that message, so that
            answering you is a single click rather than a re-typed address.
          </p>
          <p>
            Your IP address is held in the server's memory for up to one hour, purely to stop the
            form being submitted hundreds of times by a script. It is never written to disk and is
            gone when the server restarts.
          </p>
          <p>
            One honest caveat. If the email fails to send, the server writes the full enquiry into
            our hosting provider's logs so that it is not simply lost — your request reaching us
            matters more than it being tidy. Those logs are retained by the host for a limited
            period and are visible only to us.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Your enquiry sits in our email for as long as it is useful — while we are talking, and
            afterwards if your parent moves in, because it becomes part of how they came to us. If
            you would rather it did not, say so and we will delete it.
          </p>
          <p>
            If someone becomes a resident, their care records are a separate matter governed by the
            rules we are licensed under, not by this page.
          </p>
        </Section>

        <Section title="What we never do">
          <ul className="ml-5 list-disc space-y-1.5">
            <li>Sell or rent anything you tell us.</li>
            <li>
              Pass your enquiry to a referral or placement agency. Those services are paid when a
              family is placed, which is exactly why we do not use them.
            </li>
            <li>Add you to a newsletter or marketing list.</li>
            <li>Use advertising or retargeting tools of any kind.</li>
          </ul>
        </Section>

        <Section title="What you can ask for">
          <p>
            Ask us what we hold about you and we will tell you. Ask us to correct it and we will.
            Ask us to delete it and we will, unless it relates to someone currently in our care and
            we are required to keep it.
          </p>
          <p>We will not ask you to justify the request, and it costs nothing.</p>
        </Section>

        <Section title="Children">
          <p>
            We provide care to adults, and this site is not directed at children. We do not
            knowingly collect information from anyone under 13.
          </p>
        </Section>

        <Section title="Security">
          <p>
            The site is served over HTTPS and the form is submitted encrypted. We keep the amount
            of information we hold small on purpose — the surest protection for a detail about your
            parent is our not having stored it anywhere.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this changes we will update the effective date at the top. We will not apply a
            change retroactively to an enquiry already sent.
          </p>
        </Section>

        <Section title="Asking us about any of this">
          <p>
            {PRIVACY_EMAIL ? (
              <>
                Write to{' '}
                <a
                  href={`mailto:${PRIVACY_EMAIL}`}
                  className="font-semibold text-slate-deep underline underline-offset-4 hover:text-clay"
                >
                  {PRIVACY_EMAIL}
                </a>
                .
              </>
            ) : (
              <>
                Privacy contact address: <Todo>not yet set</Todo>.
              </>
            )}{' '}
            {hasPhone && (
              <>
                Or call{' '}
                <a
                  href={telHref(business.phone)}
                  className="font-semibold text-slate-deep underline underline-offset-4 hover:text-clay"
                >
                  {business.phone}
                </a>
                .
              </>
            )}
            {hasAddress && (
              <>
                {' '}
                By post: {business.legalName}, {business.address.street}, {business.address.city},{' '}
                {business.address.state} {business.address.zip}.
              </>
            )}
          </p>
        </Section>

        <div className="mt-14 border-t border-sand-deep/60 pt-8">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-full bg-navy px-6 py-3.5 font-semibold text-cream transition-colors hover:bg-night"
          >
            Back to the home
          </button>
        </div>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl leading-snug sm:text-3xl">{title}</h2>
      <div className="mt-4 space-y-4 text-[1.05rem] leading-relaxed text-navy-soft">{children}</div>
    </section>
  )
}
