import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import './styles/studio.css';

mount(App, { target: document.getElementById('app')! });
