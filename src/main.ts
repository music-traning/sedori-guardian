import { createApp } from 'vue'
import { inject } from '@vercel/analytics';
import './style.css'

inject();

import App from './App.vue'

createApp(App).mount('#app')