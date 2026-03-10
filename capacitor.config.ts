import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.bspl.cricket',
  appName: 'BSPL',
  webDir: 'out',
  server: {
    url: 'https://bspl.vercel.app',
    cleartext: false,
  },
}

export default config
