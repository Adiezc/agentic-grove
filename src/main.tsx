/**
 * Renderer entry point. Mounts React into the single div in `index.html`.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing its #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
