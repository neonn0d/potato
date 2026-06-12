import { render } from 'preact'
import './styles.css'
import { initStore } from './store'
import { App } from './components/App'

initStore()

const root = document.getElementById('app')
if (root) render(<App />, root)
