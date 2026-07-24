<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ApplicationVolumeItem } from '../applicationVolume';
  import type { NodeDto } from '../generated/graph';
  import { nodeDisplayName } from '../graph/connection';
  import type { MessageKey } from '../i18n';
  import ApplicationVolumeList from './ApplicationVolumeList.svelte';

  export let nodes: NodeDto[];
  export let applications: ApplicationVolumeItem[] = [];
  export let outputLevels: Record<number, number | undefined> = {};
  export let defaultAudioSinkName: string | null;
  export let pendingNodeIds: Set<number>;
  export let pendingDefaultNodeId: number | null;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onSetVolume: (nodeId: number, volumePercent: number) => void;
  export let onSetMuted: (nodeId: number, muted: boolean) => void;
  export let onSetDefault: (nodeId: number) => void;
  export let onSetApplicationVolume: (applicationId: string, volumePercent: number) => void;
  export let onSetApplicationMuted: (applicationId: string, muted: boolean) => void;

  type MixerVolumeView = 'devices' | 'applications';
  const volumeUpdateInterval = 80;
  const boostWarningStorageKey = 'cordflow.output-volume-boost-warning-seen';
  const legacyBoostWarningStorageKey = 'helvum-next.output-volume-boost-warning-seen';
  const mixerVolumeViewStorageKey = 'cordflow.mixer-volume-view';
  const storedMixerVolumeView = localStorage.getItem(mixerVolumeViewStorageKey);
  let mixerVolumeView: MixerVolumeView =
    storedMixerVolumeView === 'applications' ? 'applications' : 'devices';
  let previewVolumes: Record<number, number | undefined> = {};
  let boostHintNodeId: number | null = null;
  let boostHintTimer = 0;
  const storedBoostWarning =
    localStorage.getItem(boostWarningStorageKey) ??
    localStorage.getItem(legacyBoostWarningStorageKey);
  if (localStorage.getItem(boostWarningStorageKey) === null && storedBoostWarning !== null) {
    localStorage.setItem(boostWarningStorageKey, storedBoostWarning);
  }
  let boostWarningSeen = storedBoostWarning === 'true';
  const observedPendingNodeIds: Record<number, true | undefined> = {};
  const volumeTimers: Record<number, number | undefined> = {};
  const lastSentVolumes: Record<number, number | undefined> = {};

  $: {
    const nextPreviews = { ...previewVolumes };
    let previewsChanged = false;

    for (const nodeId of pendingNodeIds) {
      observedPendingNodeIds[nodeId] = true;
    }
    for (const [rawNodeId, preview] of Object.entries(nextPreviews)) {
      const nodeId = Number(rawNodeId);
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (
        !node ||
        node.volumePercent === preview ||
        (observedPendingNodeIds[nodeId] && !pendingNodeIds.has(nodeId))
      ) {
        delete nextPreviews[nodeId];
        delete lastSentVolumes[nodeId];
        previewsChanged = true;
        delete observedPendingNodeIds[nodeId];
      }
    }
    if (previewsChanged) previewVolumes = nextPreviews;
  }

  function displayedVolume(
    node: NodeDto,
    previews: Record<number, number | undefined>,
  ): number | undefined {
    return previews[node.id] ?? node.volumePercent;
  }

  function sendVolume(nodeId: number, volumePercent: number): void {
    if (lastSentVolumes[nodeId] === volumePercent) return;
    lastSentVolumes[nodeId] = volumePercent;
    onSetVolume(nodeId, volumePercent);
  }

  function previewVolume(nodeId: number, event: Event): void {
    const volumePercent = Number((event.currentTarget as HTMLInputElement).value);
    showBoostHint(nodeId, volumePercent);
    previewVolumes = { ...previewVolumes, [nodeId]: volumePercent };
    if (volumeTimers[nodeId] !== undefined) return;

    sendVolume(nodeId, volumePercent);
    const timer = window.setTimeout(() => {
      delete volumeTimers[nodeId];
      const latestVolume = previewVolumes[nodeId];
      if (latestVolume !== undefined) sendVolume(nodeId, latestVolume);
    }, volumeUpdateInterval);
    volumeTimers[nodeId] = timer;
  }

  function commitVolume(nodeId: number, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.value.trim() === '') {
      input.value = String(
        previewVolumes[nodeId] ??
          nodes.find((candidate) => candidate.id === nodeId)?.volumePercent ??
          0,
      );
      return;
    }
    const volumePercent = Math.min(150, Math.max(0, Math.round(Number(input.value))));
    input.value = String(volumePercent);
    showBoostHint(nodeId, volumePercent);
    previewVolumes = { ...previewVolumes, [nodeId]: volumePercent };
    const timer = volumeTimers[nodeId];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete volumeTimers[nodeId];
    }
    sendVolume(nodeId, volumePercent);
  }

  function resetVolume(nodeId: number): void {
    previewVolumes = { ...previewVolumes, [nodeId]: 100 };
    const timer = volumeTimers[nodeId];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete volumeTimers[nodeId];
    }
    sendVolume(nodeId, 100);
  }

  function showBoostHint(nodeId: number, volumePercent: number): void {
    if (volumePercent <= 100 || boostWarningSeen) return;
    boostWarningSeen = true;
    localStorage.setItem(boostWarningStorageKey, 'true');
    boostHintNodeId = nodeId;
    window.clearTimeout(boostHintTimer);
    boostHintTimer = window.setTimeout(() => {
      boostHintNodeId = null;
    }, 7_000);
  }

  function dismissBoostHint(): void {
    boostHintNodeId = null;
    window.clearTimeout(boostHintTimer);
  }

  function effectiveOutputPeak(
    node: NodeDto,
    volumePercent: number | undefined,
    levels: Record<number, number | undefined>,
  ): number | undefined {
    const rawPeak = levels[node.id];
    if (rawPeak === undefined) return undefined;
    if (node.muted) return 0;
    const gain = Math.pow((volumePercent ?? 100) / 100, 3);
    return Math.max(0, rawPeak * gain);
  }

  function peakDecibels(peak: number | undefined): number | undefined {
    if (peak === undefined) return undefined;
    if (peak <= 0) return -60;
    return Math.min(6, Math.max(-60, 20 * Math.log10(peak)));
  }

  function meterFill(decibels: number | undefined, volumePercent: number | undefined): number {
    if (decibels === undefined) return 0;
    const peakFill = ((decibels + 60) / 66) * 100;
    const volumeLimit = (Math.min(150, Math.max(0, volumePercent ?? 0)) / 150) * 100;
    return Math.min(peakFill, volumeLimit);
  }

  function outputLevelText(peak: number | undefined, decibels: number | undefined): string {
    if (peak === undefined || decibels === undefined) return t('outputLevelUnavailable');
    if (peak <= 0) return t('outputLevelSilent');
    return t('outputLevelDb', { value: decibels.toFixed(1) });
  }

  function setDefaultDevice(nodeId: number): void {
    onSetDefault(nodeId);
  }

  function changeMixerVolumeView(view: MixerVolumeView): void {
    mixerVolumeView = view;
    localStorage.setItem(mixerVolumeViewStorageKey, view);
  }

  function deviceTypeLabel(node: NodeDto): MessageKey {
    const identity =
      `${node.name ?? ''} ${node.mediaName ?? ''} ${node.objectName ?? ''}`.toLowerCase();
    if (identity.includes('bluez') || identity.includes('bluetooth')) {
      return 'bluetoothDevice';
    }
    if (identity.includes('hdmi')) {
      return 'hdmiDevice';
    }
    if (
      node.mediaClass?.startsWith('Audio/Sink/Virtual') ||
      identity.includes('easyeffects') ||
      identity.includes('virtual')
    ) {
      return 'virtualDevice';
    }
    if (
      identity.includes('headphone') ||
      identity.includes('headset') ||
      identity.includes(' ear')
    ) {
      return 'headphonesDevice';
    }
    return 'audioOutputDevice';
  }

  onDestroy(() => {
    window.clearTimeout(boostHintTimer);
    for (const timer of Object.values(volumeTimers)) {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  });
</script>

<section
  class="output-volume-workspace"
  aria-label={t('outputVolumes')}
  data-testid="output-volume-workspace"
>
  <div class="mixer-volume-tabs" role="tablist" aria-label={t('mixerVolumeViews')}>
    <button
      id="mixer-device-volume-tab"
      class:mixer-volume-tabs__tab--active={mixerVolumeView === 'devices'}
      class="mixer-volume-tabs__tab"
      type="button"
      role="tab"
      aria-selected={mixerVolumeView === 'devices'}
      aria-controls="mixer-device-volume-panel"
      data-testid="mixer-device-volume-tab"
      onclick={() => changeMixerVolumeView('devices')}
    >
      <span aria-hidden="true">[O]</span>
      {t('deviceVolumes')}
    </button>
    <button
      id="mixer-application-volume-tab"
      class:mixer-volume-tabs__tab--active={mixerVolumeView === 'applications'}
      class="mixer-volume-tabs__tab"
      type="button"
      role="tab"
      aria-selected={mixerVolumeView === 'applications'}
      aria-controls="mixer-application-volume-panel"
      data-testid="mixer-application-volume-tab"
      onclick={() => changeMixerVolumeView('applications')}
    >
      <span aria-hidden="true">[A]</span>
      {t('applicationVolumes')}
    </button>
  </div>

  {#if mixerVolumeView === 'devices'}
    <div
      id="mixer-device-volume-panel"
      class="mixer-volume-panel"
      role="tabpanel"
      aria-labelledby="mixer-device-volume-tab"
      data-testid="mixer-device-volume-panel"
    >
      {#if nodes.length === 0}
        <div class="output-volume-empty">{t('noOutputDevices')}</div>
      {:else}
        <div class="output-volume-grid">
          {#each nodes as node (node.id)}
            {@const currentVolume = displayedVolume(node, previewVolumes)}
            {@const currentPeak = effectiveOutputPeak(node, currentVolume, outputLevels)}
            {@const currentDecibels = peakDecibels(currentPeak)}
            {@const currentLevelText = outputLevelText(currentPeak, currentDecibels)}
            {@const deviceType = deviceTypeLabel(node)}
            <article
              class:output-volume-card--muted={node.muted}
              class="output-volume-card"
              data-testid={`output-volume-device-${node.id}`}
            >
              <header>
                <span
                  class="output-volume-card__device-icon"
                  role="img"
                  aria-label={t(deviceType)}
                  title={t(deviceType)}
                  data-testid={`output-volume-device-type-${node.id}`}
                >
                  <span aria-hidden="true">[{t(deviceType)}]</span>
                </span>
                <div class="output-volume-card__identity">
                  <div class="output-volume-card__identity-title">
                    <h2 title={nodeDisplayName(node, t('unnamedNode'))}>
                      {nodeDisplayName(node, t('unnamedNode'))}
                    </h2>
                    {#if node.objectName === defaultAudioSinkName}
                      <span class="output-volume-card__tag output-volume-card__tag--default">
                        {t('defaultTag')}
                      </span>
                    {/if}
                  </div>
                  <small title={node.objectName ?? t('nodeIdShort', { id: node.id })}>
                    {node.objectName ?? t('nodeIdShort', { id: node.id })}
                  </small>
                </div>
                <div class="output-volume-card__header-actions">
                  <div class="output-volume-card__tags">
                    {#if currentVolume !== undefined && currentVolume > 100}
                      <span class="output-volume-card__tag output-volume-card__tag--boost">
                        {t('boostTag')}
                      </span>
                    {/if}
                  </div>
                  <button
                    class="output-volume-card__default-action"
                    type="button"
                    disabled={node.objectName === defaultAudioSinkName ||
                      pendingDefaultNodeId !== null}
                    data-testid={`output-volume-default-${node.id}`}
                    onclick={() => setDefaultDevice(node.id)}
                  >
                    {node.objectName === defaultAudioSinkName
                      ? t('currentDefaultDevice')
                      : t('setAsDefaultDevice')}
                  </button>
                </div>
              </header>

              <div class="output-volume-card__control">
                <div class="output-volume-card__slider">
                  <label>
                    <span class="sr-only">
                      {t('deviceVolume', { name: nodeDisplayName(node, t('unnamedNode')) })}
                    </span>
                    <div
                      class:output-volume-card__level-meter--warning={currentDecibels !==
                        undefined &&
                        currentDecibels >= -6 &&
                        currentDecibels < 0}
                      class:output-volume-card__level-meter--danger={currentDecibels !==
                        undefined && currentDecibels >= 0}
                      class="output-volume-card__level-meter"
                      role="meter"
                      aria-label={t('outputLevelFor', {
                        name: nodeDisplayName(node, t('unnamedNode')),
                      })}
                      aria-valuemin="-60"
                      aria-valuemax="6"
                      aria-valuenow={currentDecibels ?? -60}
                      aria-valuetext={currentLevelText}
                      data-testid={`output-level-meter-${node.id}`}
                    >
                      <span
                        class="output-volume-card__level-fill"
                        style={`width: ${meterFill(currentDecibels, currentVolume)}%`}
                        data-testid={`output-level-fill-${node.id}`}
                      ></span>
                      <span
                        class="output-volume-card__level-tick output-volume-card__level-tick--quiet"
                      ></span>
                      <span
                        class="output-volume-card__level-tick output-volume-card__level-tick--warning"
                      ></span>
                      <span
                        class="output-volume-card__level-tick output-volume-card__level-tick--clip"
                      ></span>
                    </div>
                    <input
                      id={`output-volume-slider-${node.id}`}
                      type="range"
                      min="0"
                      max="150"
                      step="1"
                      value={currentVolume ?? 0}
                      class:output-volume-card__range--boost={currentVolume !== undefined &&
                        currentVolume > 100}
                      disabled={node.volumePercent === undefined}
                      data-testid={`output-volume-slider-${node.id}`}
                      oninput={(event) => previewVolume(node.id, event)}
                      onchange={(event) => commitVolume(node.id, event)}
                    />
                  </label>
                  <div class="output-volume-card__scale" aria-hidden="true">
                    <span>0</span>
                    <span>100</span>
                    <span>150</span>
                  </div>
                  <div class="output-volume-card__regions">
                    <output
                      class="output-volume-card__level-value"
                      data-testid={`output-level-value-${node.id}`}
                    >
                      <span aria-hidden="true">[|]</span>
                      {currentLevelText}
                    </output>
                    <span>{t('normalVolumeRange')}</span>
                    <span>{t('boostVolumeRange')}</span>
                  </div>
                </div>

                <label class="output-volume-card__number">
                  <span class="sr-only">
                    {t('editDeviceVolume', { name: nodeDisplayName(node, t('unnamedNode')) })}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="150"
                    step="1"
                    inputmode="numeric"
                    value={currentVolume ?? ''}
                    disabled={node.volumePercent === undefined}
                    aria-label={t('editDeviceVolume', {
                      name: nodeDisplayName(node, t('unnamedNode')),
                    })}
                    data-testid={`output-volume-number-${node.id}`}
                    onchange={(event) => commitVolume(node.id, event)}
                  />
                  <span aria-hidden="true">%</span>
                </label>

                <button
                  class="output-volume-card__reset"
                  type="button"
                  disabled={node.volumePercent === undefined || currentVolume === 100}
                  data-testid={`output-volume-reset-${node.id}`}
                  onclick={() => resetVolume(node.id)}
                >
                  {t('resetVolume')}
                </button>

                <button
                  class:output-volume-card__mute--active={node.muted}
                  class="output-volume-card__mute"
                  type="button"
                  disabled={node.muted === undefined || pendingNodeIds.has(node.id)}
                  aria-pressed={node.muted ?? false}
                  aria-label={t(node.muted ? 'unmuteDevice' : 'muteDevice', {
                    name: nodeDisplayName(node, t('unnamedNode')),
                  })}
                  title={t(node.muted ? 'clickToUnmute' : 'clickToMute')}
                  data-testid={`output-volume-mute-${node.id}`}
                  onclick={() => onSetMuted(node.id, !(node.muted ?? false))}
                >
                  {t(node.muted ? 'muted' : 'mute')}
                </button>
              </div>
              {#if currentVolume !== undefined && currentVolume > 100 && boostHintNodeId !== node.id}
                <p
                  class="output-volume-card__clipping-risk"
                  data-testid={`output-volume-clipping-risk-${node.id}`}
                >
                  <span class="ascii-icon" aria-hidden="true">[!]</span>
                  {t('clippingRisk')}
                </p>
              {/if}
              {#if boostHintNodeId === node.id}
                <div
                  class="output-volume-card__boost-hint"
                  role="status"
                  data-testid={`output-volume-boost-hint-${node.id}`}
                >
                  <span class="ascii-icon" aria-hidden="true">[!]</span>
                  <p>
                    <strong>{t('boostHintTitle')}</strong>
                    {t('boostHint')}
                  </p>
                  <button
                    type="button"
                    aria-label={t('dismiss')}
                    data-testid={`output-volume-boost-dismiss-${node.id}`}
                    onclick={dismissBoostHint}
                  >
                    <span class="ascii-icon" aria-hidden="true">[x]</span>
                  </button>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div
      id="mixer-application-volume-panel"
      class="mixer-volume-panel"
      role="tabpanel"
      aria-labelledby="mixer-application-volume-tab"
      data-testid="mixer-application-volume-panel"
    >
      <ApplicationVolumeList
        {applications}
        {pendingNodeIds}
        {t}
        onSetVolume={onSetApplicationVolume}
        onSetMuted={onSetApplicationMuted}
      />
    </div>
  {/if}
</section>
