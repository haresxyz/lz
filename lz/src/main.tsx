import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css' // kalau file ini belum ada, buat kosong atau hapus baris ini

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
