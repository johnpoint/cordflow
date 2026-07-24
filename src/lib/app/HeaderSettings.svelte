<script lang="ts">
  import { Settings } from '@lucide/svelte';
  import cordflowLogo from '../../../src-tauri/icons/icon.svg';
  import type { MessageKey } from '../i18n';

  export let settingsOpen: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onOpenSettings: (trigger: HTMLElement) => void;
  export let onMinimize: () => void;
  export let onToggleMaximize: () => void;
  export let onCloseWindow: () => void;
</script>

<header class="app-header" data-tauri-drag-region>
  <div class="app-header__brand" data-tauri-drag-region>
    <img
      class="brand-logo"
      src={cordflowLogo}
      alt=""
      aria-hidden="true"
      data-testid="brand-logo"
      data-tauri-drag-region
    />
    <div data-tauri-drag-region>
      <h1 data-tauri-drag-region>{t('appName')}</h1>
      <p data-tauri-drag-region>{t('studioRouting')}</p>
    </div>
  </div>

  <div class="app-header__actions">
    <button
      class="icon-button"
      type="button"
      aria-label={t('settings')}
      aria-expanded={settingsOpen}
      data-testid="settings-menu-trigger"
      onclick={(event) => onOpenSettings(event.currentTarget)}
    >
      <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <div class="app-window-controls">
      <button
        class="app-window-control"
        type="button"
        aria-label={t('minimizeWindow')}
        title={t('minimizeWindow')}
        data-testid="window-minimize"
        onclick={onMinimize}
      >
        <span aria-hidden="true">[-]</span>
      </button>
      <button
        class="app-window-control"
        type="button"
        aria-label={t('maximizeWindow')}
        title={t('maximizeWindow')}
        data-testid="window-maximize"
        onclick={onToggleMaximize}
      >
        <span aria-hidden="true">[□]</span>
      </button>
      <button
        class="app-window-control app-window-control--close"
        type="button"
        aria-label={t('closeWindow')}
        title={t('closeWindow')}
        data-testid="window-close"
        onclick={onCloseWindow}
      >
        <span aria-hidden="true">[x]</span>
      </button>
    </div>
  </div>
</header>
