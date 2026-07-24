<script lang="ts">
  import type { GraphStatus, NodeDto } from '../generated/graph';
  import { nodeDisplayName } from '../graph/connection';
  import type { MessageKey } from '../i18n';

  export let status: GraphStatus;
  export let defaultDevicesEditing: boolean;
  export let defaultAudioSources: NodeDto[];
  export let activeDefaultAudioSource: NodeDto | null;
  export let displayedDefaultAudioSource: NodeDto | null;
  export let displayedDefaultAudioSourceId: number | '';
  export let pendingDefaultAudioSourceNodeId: number | null;
  export let defaultAudioSourceName: string | null;
  export let defaultAudioSinks: NodeDto[];
  export let activeDefaultAudioSink: NodeDto | null;
  export let displayedDefaultAudioSink: NodeDto | null;
  export let displayedDefaultAudioSinkId: number | '';
  export let pendingDefaultAudioSinkNodeId: number | null;
  export let defaultAudioSinkName: string | null;
  export let advancedModeEnabled: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onDefaultAudioSourceChange: (event: Event) => void;
  export let onDefaultAudioSinkChange: (event: Event) => void;
  export let onToggleDefaultDevicesEditing: () => void;
  export let onAdvancedModeChange: (event: Event) => void;
</script>

<footer class="app-statusbar" data-testid="app-statusbar">
  <span class={`status-chip status-chip--${status.state}`} data-testid="graph-status">
    <i aria-hidden="true"></i>{t(status.state)}
  </span>

  <div
    class:default-device-controls--editing={defaultDevicesEditing}
    class="default-device-controls"
  >
    {#if defaultDevicesEditing}
      <label class="default-device-control" data-testid="default-input-control">
        <span>{t('defaultInputDevice')}</span>
        <select
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
        {#if pendingDefaultAudioSourceNodeId !== null}
          <span class="default-device-control__pending">{t('applying')}</span>
        {/if}
      </label>
      <label class="default-device-control" data-testid="default-playback-control">
        <span>{t('defaultPlaybackDevice')}</span>
        <select
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
        {#if pendingDefaultAudioSinkNodeId !== null}
          <span class="default-device-control__pending">{t('applying')}</span>
        {/if}
      </label>
    {:else}
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
    {/if}
  </div>

  <button
    class="button button--small default-device-controls__edit"
    type="button"
    aria-pressed={defaultDevicesEditing}
    data-testid="default-devices-edit"
    onclick={onToggleDefaultDevicesEditing}
  >
    {t(defaultDevicesEditing ? 'finishEditingDefaultDevices' : 'editDefaultDevices')}
  </button>

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
    <strong>{t(advancedModeEnabled ? 'enabled' : 'disabled')}</strong>
  </label>
</footer>
