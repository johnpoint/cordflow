<script lang="ts">
  import { Plus } from '@lucide/svelte';
  import type { GraphStatus } from '../generated/graph';
  import type { MessageKey } from '../i18n';
  import type { MixerVolumeView, WorkspaceId } from '../workspace';

  export let workspaceView: WorkspaceId;
  export let advancedModeEnabled: boolean;
  export let graphStatus: GraphStatus;
  export let nodeCount: number;
  export let portCount: number;
  export let linkCount: number;
  export let mixerVolumeView: MixerVolumeView;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onChangeWorkspace: (workspace: WorkspaceId) => void;
  export let onChangeMixerVolumeView: (view: MixerVolumeView) => void;
  export let onOpenFlowBuilder: (trigger: HTMLElement) => void;
</script>

<aside class="workspace-sidebar">
  <span class="workspace-sidebar__label">{t('workspaces')}</span>
  <nav class="workspace-nav" aria-label={t('workspaceView')}>
    <button
      class:workspace-nav__item--active={workspaceView === 'mixer'}
      class="workspace-nav__item"
      type="button"
      aria-current={workspaceView === 'mixer' ? 'page' : undefined}
      aria-pressed={workspaceView === 'mixer'}
      data-testid="view-output-volumes"
      onclick={() => onChangeWorkspace('mixer')}
    >
      <span><strong>{t('outputVolumes')}</strong><small>{t('outputMixerDescription')}</small></span>
    </button>
    <button
      class:workspace-nav__item--active={workspaceView === 'flows'}
      class="workspace-nav__item"
      type="button"
      aria-current={workspaceView === 'flows' ? 'page' : undefined}
      aria-pressed={workspaceView === 'flows'}
      data-testid="view-audio-flows"
      onclick={() => onChangeWorkspace('flows')}
    >
      <span><strong>{t('audioFlows')}</strong><small>{t('audioFlowsDescription')}</small></span>
    </button>
    {#if advancedModeEnabled}
      <button
        class:workspace-nav__item--active={workspaceView === 'patchbay'}
        class="workspace-nav__item"
        type="button"
        aria-current={workspaceView === 'patchbay' ? 'page' : undefined}
        aria-pressed={workspaceView === 'patchbay'}
        data-testid="view-port-topology"
        onclick={() => onChangeWorkspace('patchbay')}
      >
        <span
          ><strong>{t('advancedPatchbay')}</strong><small>{t('patchbayDescription')}</small></span
        >
      </button>
    {/if}
  </nav>
  {#if workspaceView === 'mixer'}
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
        onclick={() => onChangeMixerVolumeView('devices')}
      >
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
        onclick={() => onChangeMixerVolumeView('applications')}
      >
        {t('applicationVolumes')}
      </button>
    </div>
  {:else if workspaceView === 'patchbay'}
    <div
      class="workspace-sidebar__metrics"
      aria-label={t('graphSummary')}
      data-testid="patchbay-metrics"
    >
      <span>{t('nodesCount', { count: nodeCount })}</span>
      <span>{t('portsCount', { count: portCount })}</span>
      <span>{t('linksCount', { count: linkCount })}</span>
    </div>
  {:else if workspaceView === 'flows'}
    <button
      class="button button--small workspace-sidebar__action"
      type="button"
      disabled={graphStatus.state !== 'connected'}
      data-testid="flow-builder-open"
      onclick={(event) => onOpenFlowBuilder(event.currentTarget)}
    >
      <Plus size={15} aria-hidden="true" />{t('createAudioFlow')}
    </button>
  {/if}
</aside>
