import { AppController } from './AppController'

const container = document.getElementById('graph-container')
if (!container) {
  throw new Error('[LGB] Missing #graph-container')
}

new AppController(container).boot().catch((err) => {
  console.error('[LGB] Init failed:', err)
})
