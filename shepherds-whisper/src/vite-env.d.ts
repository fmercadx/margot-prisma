/// <reference types="vite/client" />

interface ImportMetaEnv {
  /* Where the tour request is POSTed as JSON. Set this in Railway's variables
     to a form backend you control. Left unset, the wizard falls back to opening
     a prefilled email to the address in `business.ts`, and if that is unset too
     it shows the phone number instead — it never silently drops an enquiry. */
  readonly VITE_FORM_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
