import '@/styles/globals.css'
import { PlayerProvider } from '@/context'

export default function App({ Component, pageProps }) {
  return (
    <PlayerProvider>
      <Component {...pageProps} />
    </PlayerProvider>
  )
}
