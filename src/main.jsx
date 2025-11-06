import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import './styles/shared.css'

const bootstrapPWA = () => {
  if (!('serviceWorker' in navigator)) {
    return
  }

  if (import.meta.env.DEV) {
    navigator.serviceWorker
      .getRegistrations?.()
      .then((registrations) => registrations.forEach((registration) => registration.unregister()))
      .catch(() => {})
    return
  }

  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: false,
      onNeedRefresh() {
        const shouldRefresh = window.confirm(
          'Er is een nieuwe versie van Stamjer beschikbaar. Nu herladen voor de laatste updates?'
        )
        if (shouldRefresh) {
          updateSW(true)
        }
      },
      onOfflineReady() {
        console.info('Stamjer is klaar voor offline gebruik.')
      }
    })

    // Trigger an update check whenever the app window regains focus.
    window.addEventListener('focus', () => updateSW())
  }).catch((error) => {
    console.error('Registreren van de service worker is mislukt:', error)
  })
}

bootstrapPWA()

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
