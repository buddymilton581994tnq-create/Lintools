import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import './themes.css'
import { initTheme } from './lib/themes'
import { initFontSize } from './lib/fontSize'
import App from './App.tsx'

initTheme()
initFontSize()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
