<script lang="ts">
  import type { Locale, MessageKey } from '../i18n';

  export let settingsOpen: boolean;
  export let locale: Locale;
  export let resyncing: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onToggleSettings: () => void;
  export let onCloseSettings: () => void;
  export let onLocaleChange: (event: Event) => void;
  export let onResync: () => void;
  export let onMinimize: () => void;
  export let onToggleMaximize: () => void;
  export let onCloseWindow: () => void;
</script>

<header class="app-header" data-tauri-drag-region>
  <div class="app-header__brand" data-tauri-drag-region>
    <span class="brand-mark" aria-hidden="true" data-tauri-drag-region>[CF]</span>
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
      onclick={onToggleSettings}
    >
      <span class="ascii-icon" aria-hidden="true">[..]</span>
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

  {#if settingsOpen}
    <div class="settings-menu" data-testid="settings-menu">
      <header>
        <strong>{t('settings')}</strong>
        <button
          class="icon-button"
          type="button"
          aria-label={t('closeSettings')}
          onclick={onCloseSettings}
        >
          <span class="ascii-icon" aria-hidden="true">[x]</span>
        </button>
      </header>
      <label class="settings-menu__row">
        <span><span class="ascii-icon" aria-hidden="true">[A]</span>{t('language')}</span>
        <select value={locale} onchange={onLocaleChange} aria-label={t('language')}>
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
      </label>
      <button
        class="button settings-menu__action"
        type="button"
        disabled={resyncing}
        onclick={onResync}
      >
        <span class="ascii-icon" aria-hidden="true">[r]</span>
        {t(resyncing ? 'resyncing' : 'refresh')}
      </button>
    </div>
  {/if}
</header>
