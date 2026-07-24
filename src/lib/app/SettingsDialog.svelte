<script lang="ts">
  import { AudioWaveform, Languages, Mic, RefreshCw, Volume2, X } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import type { GraphStatus, NodeDto } from '../generated/graph';
  import { nodeDisplayName } from '../graph/connection';
  import type { Locale, MessageKey } from '../i18n';

  export let locale: Locale;
  export let resyncing: boolean;
  export let status: GraphStatus;
  export let defaultAudioSources: NodeDto[];
  export let activeDefaultAudioSource: NodeDto | null;
  export let displayedDefaultAudioSourceId: number | '';
  export let pendingDefaultAudioSourceNodeId: number | null;
  export let defaultAudioSourceName: string | null;
  export let defaultAudioSinks: NodeDto[];
  export let activeDefaultAudioSink: NodeDto | null;
  export let displayedDefaultAudioSinkId: number | '';
  export let pendingDefaultAudioSinkNodeId: number | null;
  export let defaultAudioSinkName: string | null;
  export let outputSpectrumEnabled: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onDefaultAudioSourceChange: (event: Event) => void;
  export let onDefaultAudioSinkChange: (event: Event) => void;
  export let onLocaleChange: (event: Event) => void;
  export let onOutputSpectrumChange: (event: Event) => void;
  export let onResync: () => void;
  export let onClose: () => void;

  let dialogElement: HTMLElement;
  let closeButton: HTMLButtonElement;

  function handleWindowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [
      ...dialogElement.querySelectorAll<HTMLElement>('button, select, input, [tabindex]'),
    ].filter(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.getAttribute('tabindex') !== '-1' &&
        !element.getAttribute('aria-hidden'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMount(() => closeButton.focus());
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div class="settings-dialog-backdrop" data-testid="settings-menu">
  <button
    class="settings-dialog-backdrop__dismiss"
    type="button"
    tabindex="-1"
    aria-label={t('closeSettings')}
    onclick={onClose}
  ></button>

  <div
    class="settings-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-dialog-title"
    bind:this={dialogElement}
  >
    <header class="settings-dialog__header">
      <div>
        <span class="settings-dialog__eyebrow">{t('appName')}</span>
        <h2 id="settings-dialog-title">{t('settings')}</h2>
      </div>
      <button
        class="icon-button settings-dialog__close"
        type="button"
        aria-label={t('closeSettings')}
        data-testid="settings-menu-close"
        bind:this={closeButton}
        onclick={onClose}
      >
        <X size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </header>

    <div class="settings-dialog__body">
      <label
        class="settings-dialog__row settings-dialog__row--device"
        for="settings-default-playback"
        data-testid="settings-default-playback-control"
      >
        <span class="settings-dialog__label">
          <Volume2 size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <strong>{t('defaultPlaybackDevice')}</strong>
            {#if pendingDefaultAudioSinkNodeId !== null}
              <small role="status">{t('applying')}</small>
            {/if}
          </span>
        </span>
        <select
          id="settings-default-playback"
          value={displayedDefaultAudioSinkId}
          disabled={status.state !== 'connected' ||
            defaultAudioSinks.length === 0 ||
            pendingDefaultAudioSinkNodeId !== null}
          aria-label={t('defaultPlaybackDevice')}
          onchange={onDefaultAudioSinkChange}
        >
          {#if !activeDefaultAudioSink && pendingDefaultAudioSinkNodeId === null}
            <option value="">{t('defaultPlaybackUnknown')}</option>
          {/if}
          {#each defaultAudioSinks as node (node.id)}
            <option value={node.id}>
              {nodeDisplayName(node, t('unnamedNode'))}
              {node.objectName === defaultAudioSinkName ? ` · ${t('currentDefault')}` : ''}
            </option>
          {/each}
        </select>
      </label>

      <label
        class="settings-dialog__row settings-dialog__row--device"
        for="settings-default-input"
        data-testid="settings-default-input-control"
      >
        <span class="settings-dialog__label">
          <Mic size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <strong>{t('defaultInputDevice')}</strong>
            {#if pendingDefaultAudioSourceNodeId !== null}
              <small role="status">{t('applying')}</small>
            {/if}
          </span>
        </span>
        <select
          id="settings-default-input"
          value={displayedDefaultAudioSourceId}
          disabled={status.state !== 'connected' ||
            defaultAudioSources.length === 0 ||
            pendingDefaultAudioSourceNodeId !== null}
          aria-label={t('defaultInputDevice')}
          onchange={onDefaultAudioSourceChange}
        >
          {#if !activeDefaultAudioSource && pendingDefaultAudioSourceNodeId === null}
            <option value="">{t('defaultInputUnknown')}</option>
          {/if}
          {#each defaultAudioSources as node (node.id)}
            <option value={node.id}>
              {nodeDisplayName(node, t('unnamedNode'))}
              {node.objectName === defaultAudioSourceName ? ` · ${t('currentDefault')}` : ''}
            </option>
          {/each}
        </select>
      </label>

      <label class="settings-dialog__row" for="settings-language">
        <span class="settings-dialog__label">
          <Languages size={18} strokeWidth={1.8} aria-hidden="true" />
          <strong>{t('language')}</strong>
        </span>
        <select
          id="settings-language"
          value={locale}
          onchange={onLocaleChange}
          aria-label={t('language')}
        >
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
      </label>

      <label
        class="settings-dialog__row settings-dialog__switch"
        data-testid="settings-output-spectrum-control"
      >
        <span class="settings-dialog__label">
          <AudioWaveform size={18} strokeWidth={1.8} aria-hidden="true" />
          <strong>{t('outputSpectrumBackground')}</strong>
        </span>
        <input
          class="custom-mode-switch__input"
          type="checkbox"
          checked={outputSpectrumEnabled}
          aria-label={t('outputSpectrumBackground')}
          data-testid="settings-output-spectrum-toggle"
          onchange={onOutputSpectrumChange}
        />
        <span class="custom-mode-switch__track" aria-hidden="true"><i></i></span>
      </label>
    </div>

    <footer class="settings-dialog__footer">
      <button
        class="button settings-dialog__action"
        type="button"
        disabled={resyncing}
        onclick={onResync}
      >
        <RefreshCw
          class={resyncing ? 'settings-dialog__action-icon--spinning' : undefined}
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
        />
        {t(resyncing ? 'resyncing' : 'refresh')}
      </button>
    </footer>
  </div>
</div>
