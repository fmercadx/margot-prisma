/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Deep navy carries every piece of body copy. Against `cream` it sits
           around 13:1, well past WCAG AA, which is the point: the people
           reading this are often making the decision for a parent, on a phone,
           in their sixties or seventies themselves. */
        night: '#111E33',
        navy: '#1F3557',
        'navy-soft': '#3A5375',

        /* Soft slate blue. Decorative, borders, and large text only — on cream
           it is about 3.5:1, so it must never carry small body copy. */
        slate: '#5B7C9D',
        'slate-deep': '#2F4A68',
        'slate-mist': '#DCE6EF',

        /* Warm sand and cream. The brief is explicit that this must not read as
           a hospital, so there is no sterile white anywhere in the palette. */
        cream: '#FBF7F2',
        linen: '#F5EDE3',
        sand: '#EADCC8',
        'sand-deep': '#D8C4A8',

        sage: '#6E8C77',
        clay: '#A85A3C',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      fontSize: {
        /* Body text floors at 17px rather than the usual 16px. */
        base: ['1.0625rem', { lineHeight: '1.7' }],
        lg: ['1.1875rem', { lineHeight: '1.7' }],
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.75rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(17,30,51,0.04), 0 8px 24px -12px rgba(17,30,51,0.18)',
        lift: '0 2px 4px rgba(17,30,51,0.05), 0 24px 48px -20px rgba(17,30,51,0.28)',
      },
      maxWidth: {
        prose: '68ch',
      },
    },
  },
  plugins: [],
}
