import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/panels.css'
import './styles/search.css'
import './styles/nodes.css'
import './styles/minimap.css'
import './styles/activity.css'
import './styles/legend.css'
import './styles/components.css'
import './styles/animations.css'

import { AppController } from './AppController'

const container = document.getElementById('graph-container')
if (!container) {
  throw new Error('[LGB] Missing #graph-container')
}

new AppController(container).boot().catch((err) => {
  console.error('[LGB] Init failed:', err)
})
