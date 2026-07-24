<script lang="ts">
  import type { GraphStatus, NodeDto } from '../generated/graph';
  import { nodeDisplayName } from '../graph/connection';
  import type { MessageKey } from '../i18n';

  export let status: GraphStatus;
  export let displayedDefaultAudioSource: NodeDto | null;
  export let pendingDefaultAudioSourceNodeId: number | null;
  export let displayedDefaultAudioSink: NodeDto | null;
  export let pendingDefaultAudioSinkNodeId: number | null;
  export let advancedModeEnabled: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onAdvancedModeChange: (event: Event) => void;
</script>

<footer class="app-statusbar" data-testid="app-statusbar">
  <span class={`status-chip status-chip--${status.state}`} data-testid="graph-status">
    <i aria-hidden="true"></i>{t(status.state)}
  </span>

  <div class="default-device-controls">
    <div class="default-device-control" data-testid="default-input-control">
      <span>{t('defaultInputDevice')}</span>
      <strong
        title={displayedDefaultAudioSource
          ? nodeDisplayName(displayedDefaultAudioSource, t('unnamedNode'))
          : t('defaultInputUnknown')}
      >
        {displayedDefaultAudioSource
          ? nodeDisplayName(displayedDefaultAudioSource, t('unnamedNode'))
          : t('defaultInputUnknown')}
      </strong>
      {#if pendingDefaultAudioSourceNodeId !== null}
        <span class="default-device-control__pending">{t('applying')}</span>
      {/if}
    </div>
    <div class="default-device-control" data-testid="default-playback-control">
      <span>{t('defaultPlaybackDevice')}</span>
      <strong
        title={displayedDefaultAudioSink
          ? nodeDisplayName(displayedDefaultAudioSink, t('unnamedNode'))
          : t('defaultPlaybackUnknown')}
      >
        {displayedDefaultAudioSink
          ? nodeDisplayName(displayedDefaultAudioSink, t('unnamedNode'))
          : t('defaultPlaybackUnknown')}
      </strong>
      {#if pendingDefaultAudioSinkNodeId !== null}
        <span class="default-device-control__pending">{t('applying')}</span>
      {/if}
    </div>
  </div>

  <label class="custom-mode-switch" data-testid="advanced-mode-control">
    <span>{t('customMode')}</span>
    <input
      class="custom-mode-switch__input"
      type="checkbox"
      checked={advancedModeEnabled}
      aria-label={t('customMode')}
      data-testid="advanced-mode-toggle"
      onchange={onAdvancedModeChange}
    />
    <span class="custom-mode-switch__track" aria-hidden="true"><i></i></span>
  </label>
</footer>
