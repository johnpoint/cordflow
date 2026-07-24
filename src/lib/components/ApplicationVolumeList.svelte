<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ApplicationVolumeItem } from '../applicationVolume';
  import type { MessageKey } from '../i18n';

  export let applications: ApplicationVolumeItem[];
  export let pendingNodeIds: Set<number>;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onSetVolume: (applicationId: string, volumePercent: number) => void;
  export let onSetMuted: (applicationId: string, muted: boolean) => void;

  const volumeUpdateInterval = 80;
  let previewVolumes: Record<string, number | undefined> = {};
  const volumeTimers: Record<string, number | undefined> = {};
  const lastSentVolumes: Record<string, number | undefined> = {};

  $: {
    const nextPreviews = { ...previewVolumes };
    let changed = false;
    for (const [applicationId, preview] of Object.entries(nextPreviews)) {
      const application = applications.find((candidate) => candidate.id === applicationId);
      if (!application || application.volumePercent === preview) {
        delete nextPreviews[applicationId];
        delete lastSentVolumes[applicationId];
        changed = true;
      }
    }
    if (changed) previewVolumes = nextPreviews;
  }

  function displayedVolume(application: ApplicationVolumeItem): number {
    return previewVolumes[application.id] ?? application.volumePercent;
  }

  function applicationTestId(applicationId: string): string {
    return applicationId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function applicationPending(application: ApplicationVolumeItem): boolean {
    return application.nodeIds.some((nodeId) => pendingNodeIds.has(nodeId));
  }

  function sendVolume(applicationId: string, volumePercent: number): void {
    if (lastSentVolumes[applicationId] === volumePercent) return;
    lastSentVolumes[applicationId] = volumePercent;
    onSetVolume(applicationId, volumePercent);
  }

  function previewVolume(applicationId: string, event: Event): void {
    const volumePercent = Number((event.currentTarget as HTMLInputElement).value);
    previewVolumes = { ...previewVolumes, [applicationId]: volumePercent };
    if (volumeTimers[applicationId] !== undefined) return;
    sendVolume(applicationId, volumePercent);
    volumeTimers[applicationId] = window.setTimeout(() => {
      delete volumeTimers[applicationId];
      const latest = previewVolumes[applicationId];
      if (latest !== undefined) sendVolume(applicationId, latest);
    }, volumeUpdateInterval);
  }

  function commitVolume(applicationId: string, currentValue: number, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.value.trim() === '') {
      input.value = String(previewVolumes[applicationId] ?? currentValue);
      return;
    }
    const volumePercent = Math.min(150, Math.max(0, Math.round(Number(input.value))));
    input.value = String(volumePercent);
    previewVolumes = { ...previewVolumes, [applicationId]: volumePercent };
    const timer = volumeTimers[applicationId];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete volumeTimers[applicationId];
    }
    sendVolume(applicationId, volumePercent);
  }

  function resetVolume(applicationId: string): void {
    previewVolumes = { ...previewVolumes, [applicationId]: 100 };
    const timer = volumeTimers[applicationId];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete volumeTimers[applicationId];
    }
    sendVolume(applicationId, 100);
  }

  onDestroy(() => {
    for (const timer of Object.values(volumeTimers)) {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  });
</script>

{#if applications.length > 0}
  <div
    class="output-volume-grid application-volume-grid"
    aria-label={t('applicationVolumes')}
    data-testid="application-volume-list"
  >
    {#each applications as application (application.id)}
      {@const currentVolume = displayedVolume(application)}
      {@const testId = applicationTestId(application.id)}
      {@const pending = applicationPending(application)}
      <article
        class:output-volume-card--muted={application.muted}
        class:application-volume-card--offline={!application.active}
        class="output-volume-card application-volume-card"
        data-testid={`application-volume-${testId}`}
      >
        <header>
          <span
            class="output-volume-card__device-icon application-volume-card__icon"
            role="img"
            aria-label={t('applicationAudio')}
          >
            <span aria-hidden="true">[A]</span>
          </span>
          <div class="output-volume-card__identity">
            <h2 title={application.name}>{application.name}</h2>
            <small title={application.id}>{application.id}</small>
          </div>
          <div class="output-volume-card__tags">
            <span
              class:application-volume-card__state--active={application.active}
              class="output-volume-card__tag application-volume-card__state"
            >
              {t(application.active ? 'applicationActive' : 'applicationWaiting')}
            </span>
            {#if currentVolume > 100}
              <span class="output-volume-card__tag output-volume-card__tag--boost">
                {t('boostTag')}
              </span>
            {/if}
          </div>
        </header>

        <div class="output-volume-card__control">
          <div class="output-volume-card__slider">
            <label>
              <span class="sr-only">
                {t('applicationVolumeFor', { name: application.name })}
              </span>
              <div class="output-volume-card__level-meter" aria-hidden="true">
                <span
                  class="output-volume-card__level-fill application-volume-card__preference-fill"
                  style={`width: ${(currentVolume / 150) * 100}%`}
                ></span>
              </div>
              <input
                type="range"
                min="0"
                max="150"
                step="1"
                value={currentVolume}
                class:output-volume-card__range--boost={currentVolume > 100}
                aria-label={t('applicationVolumeFor', { name: application.name })}
                data-testid={`application-volume-slider-${testId}`}
                oninput={(event) => previewVolume(application.id, event)}
                onchange={(event) => commitVolume(application.id, application.volumePercent, event)}
              />
            </label>
            <div class="output-volume-card__scale" aria-hidden="true">
              <span>0</span>
              <span>100</span>
              <span>150</span>
            </div>
            <div class="output-volume-card__regions">
              <span>{t('normalVolumeRange')}</span>
              <span>{t('boostVolumeRange')}</span>
            </div>
          </div>

          <label class="output-volume-card__number">
            <span class="sr-only">
              {t('editApplicationVolume', { name: application.name })}
            </span>
            <input
              type="number"
              min="0"
              max="150"
              step="1"
              inputmode="numeric"
              value={currentVolume}
              aria-label={t('editApplicationVolume', { name: application.name })}
              data-testid={`application-volume-number-${testId}`}
              onchange={(event) => commitVolume(application.id, application.volumePercent, event)}
            />
            <span aria-hidden="true">%</span>
          </label>

          <button
            class="output-volume-card__reset"
            type="button"
            disabled={currentVolume === 100}
            data-testid={`application-volume-reset-${testId}`}
            onclick={() => resetVolume(application.id)}
          >
            {t('resetVolume')}
          </button>

          <button
            class:output-volume-card__mute--active={application.muted}
            class="output-volume-card__mute"
            type="button"
            disabled={pending}
            aria-pressed={application.muted}
            aria-label={t(application.muted ? 'unmuteApplication' : 'muteApplication', {
              name: application.name,
            })}
            title={t(application.muted ? 'clickToUnmute' : 'clickToMute')}
            data-testid={`application-volume-mute-${testId}`}
            onclick={() => onSetMuted(application.id, !application.muted)}
          >
            {t(application.muted ? 'muted' : 'mute')}
          </button>
        </div>

        {#if !application.active}
          <p class="application-volume-card__offline-hint">
            {t('applicationWaitingHint')}
          </p>
        {/if}
        {#if currentVolume > 100}
          <p class="output-volume-card__clipping-risk">
            <span class="ascii-icon" aria-hidden="true">[!]</span>
            {t('clippingRisk')}
          </p>
        {/if}
      </article>
    {/each}
  </div>
{:else}
  <div class="output-volume-empty" data-testid="application-volume-empty">
    <span>{t('noRememberedApplications')}</span>
    <small>{t('applicationVolumeRetention')}</small>
  </div>
{/if}
