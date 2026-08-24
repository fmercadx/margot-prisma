import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { injectStructuredData } from './seo'
import './index.css'

injectStructuredData()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
