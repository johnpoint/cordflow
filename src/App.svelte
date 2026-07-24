<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    createGraphSession,
    type GraphSessionEvent,
    type GraphSessionOperation,
  } from './lib/app';
  import HeaderSettings from './lib/app/HeaderSettings.svelte';
  import StatusBar from './lib/app/StatusBar.svelte';
  import WorkspaceSidebar from './lib/app/WorkspaceSidebar.svelte';
  import {
    selectActiveDefaultDevice,
    selectDefaultAudioSinks,
    selectDefaultAudioSources,
    selectDisplayedDefaultDevice,
    selectGraphFocus,
    selectOutputVolumeNodes,
  } from './lib/app/selectors';
  import { createGraphBridge } from './lib/bridge';
  import AudioFlowBuilder from './lib/components/AudioFlowBuilder.svelte';
  import AudioFlowWorkspace from './lib/components/AudioFlowWorkspace.svelte';
  import ConnectionPanel from './lib/components/ConnectionPanel.svelte';
  import OutputSpectrum from './lib/components/OutputSpectrum.svelte';
  import OutputVolumeWorkspace from './lib/components/OutputVolumeWorkspace.svelte';
  import TopologyWorkspace from './lib/components/TopologyWorkspace.svelte';
  import type { LinkDto, MediaType } from './lib/generated/graph';
  import { buildAudioFlowModules } from './lib/graph/audioFlow';
  import {
    connectedChain,
    effectiveMediaType,
    expandStereoConnection,
    nodeDisplayName,
    type NormalizedPorts,
  } from './lib/graph/connection';
  import {
    detectLocale,
    setDocumentLocale,
    translate,
    type Locale,
    type MessageKey,
  } from './lib/i18n';
  import {
    advancedModeStorageKey,
    migrateWorkspacePreference,
    readAdvancedModePreference,
    workspaceRoutingPolicy,
    workspaceStorageKey,
    type RoutingPolicy,
    type WorkspaceId,
  } from './lib/workspace';

  const connectionPanelStorageKey = 'cordflow.connections-expanded';
  const legacyConnectionPanelStorageKey = 'helvum-next.connections-expanded';
  const localeStorageKey = 'cordflow.locale';
  const legacyLocaleStorageKey = 'helvum-next.locale';
  const appWindow = isTauri() ? getCurrentWindow() : null;
  const session = createGraphSession({
    bridge: createGraphBridge(),
    storage: localStorage,
    onEvent: handleSessionEvent,
  });
  let sessionState = get(session);
  const unsubscribeSessionState = session.subscribe((state) => (sessionState = state));

  let selectedLinkId: number | null = null;
  let selectedNodeId: number | null = null;
  let selectedFlowSourceId: number | null = null;
  let announcement = '';
  let errorNotice = '';
  let settingsOpen = false;
  let flowBuilderOpen = false;
  let flowBuilderReturnFocus: HTMLElement | null = null;
  let defaultDevicesEditing = false;
  const storedConnectionsExpanded =
    localStorage.getItem(connectionPanelStorageKey) ??
    localStorage.getItem(legacyConnectionPanelStorageKey);
  if (
    localStorage.getItem(connectionPanelStorageKey) === null &&
    storedConnectionsExpanded !== null
  ) {
    localStorage.setItem(connectionPanelStorageKey, storedConnectionsExpanded);
  }
  let connectionsExpanded = storedConnectionsExpanded === 'true';
  let advancedModeEnabled = readAdvancedModePreference(localStorage);
  let workspaceView: WorkspaceId = migrateWorkspacePreference(localStorage);
  if (!advancedModeEnabled && workspaceView === 'patchbay') {
    workspaceView = 'mixer';
    localStorage.setItem(workspaceStorageKey, workspaceView);
  }
  const storedLocale =
    localStorage.getItem(localeStorageKey) ?? localStorage.getItem(legacyLocaleStorageKey);
  if (localStorage.getItem(localeStorageKey) === null && storedLocale !== null) {
    localStorage.setItem(localeStorageKey, storedLocale);
  }
  let locale: Locale = detectLocale(storedLocale, navigator.languages);

  $: graph = sessionState.graph;
  $: pendingLinks = sessionState.pendingLinks;
  $: pendingDefaultAudioSink = sessionState.pendingDefaultAudioSink;
  $: pendingDefaultAudioSource = sessionState.pendingDefaultAudioSource;
  $: removingLinkIds = new Set(sessionState.pendingRemovals.map((removal) => removal.linkId));
  $: pendingOutputVolumeNodeIds = new Set(
    sessionState.pendingOutputVolumes.map((pending) => pending.nodeId),
  );
  $: audioFlowModules = buildAudioFlowModules(graph.nodes, graph.ports, graph.links);
  $: defaultAudioSinks = selectDefaultAudioSinks(graph, t('unnamedNode'), locale);
  $: activeDefaultAudioSink = selectActiveDefaultDevice(
    defaultAudioSinks,
    graph.defaultAudioSinkName,
  );
  $: displayedDefaultAudioSinkId = (pendingDefaultAudioSink?.nodeId ??
    activeDefaultAudioSink?.id ??
    '') as number | '';
  $: displayedDefaultAudioSink = selectDisplayedDefaultDevice(
    defaultAudioSinks,
    activeDefaultAudioSink,
    pendingDefaultAudioSink?.nodeId ?? null,
  );
  $: defaultAudioSources = selectDefaultAudioSources(graph, t('unnamedNode'), locale);
  $: activeDefaultAudioSource = selectActiveDefaultDevice(
    defaultAudioSources,
    graph.defaultAudioSourceName,
  );
  $: displayedDefaultAudioSourceId = (pendingDefaultAudioSource?.nodeId ??
    activeDefaultAudioSource?.id ??
    '') as number | '';
  $: displayedDefaultAudioSource = selectDisplayedDefaultDevice(
    defaultAudioSources,
    activeDefaultAudioSource,
    pendingDefaultAudioSource?.nodeId ?? null,
  );
  $: outputVolumeNodes = selectOutputVolumeNodes(graph, t('unnamedNode'), locale);
  $: graphFocus = selectGraphFocus(graph, audioFlowModules, {
    selectedLinkId,
    selectedNodeId,
    selectedFlowSourceId,
  });
  $: focusedLinkIds = graphFocus.focusedLinkIds;
  $: focusedPortIds = graphFocus.focusedPortIds;
  $: focusedNodeIds = graphFocus.focusedNodeIds;
  $: graphFocusActive = graphFocus.active;
  $: if (
    selectedFlowSourceId !== null &&
    !audioFlowModules.some((module) => module.source.id === selectedFlowSourceId)
  ) {
    selectedFlowSourceId = null;
  }
  $: if (selectedLinkId !== null && !graph.links.some((link) => link.id === selectedLinkId)) {
    selectedLinkId = null;
  }
  $: if (selectedNodeId !== null && !graph.nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = null;
  }

  function t(key: MessageKey, values: Record<string, string | number> = {}): string {
    return translate(locale, key, values);
  }

  function minimizeAppWindow(): void {
    void appWindow?.minimize();
  }

  function toggleAppWindowMaximize(): void {
    void appWindow?.toggleMaximize();
  }

  function closeAppWindow(): void {
    void appWindow?.close();
  }

  function announce(message: string): void {
    announcement = '';
    requestAnimationFrame(() => (announcement = message));
  }

  function showError(message: string): void {
    errorNotice = message;
  }

  function handleSessionEvent(event: GraphSessionEvent): void {
    switch (event.type) {
      case 'graph-gap':
        showError(t('graphGap'));
        break;
      case 'graph-read-failed':
        showError(t('graphReadFailed', { message: event.message }));
        break;
      case 'resync-started':
        announce(t('resyncing'));
        break;
      case 'resync-completed':
        announce(t('resynced'));
        break;
      case 'generation-changed':
        clearGraphSelection();
        break;
      case 'backend-reconnected':
        announce(t('backendReconnected'));
        break;
      case 'backend-unavailable':
        announce(t('backendUnavailable'));
        break;
      case 'link-requested':
        announce(t('linkRequested'));
        break;
      case 'link-created':
        announce(t('linkCreated'));
        break;
      case 'link-removed':
        if (selectedLinkId === event.linkId) selectedLinkId = null;
        announce(t('linkRemoved'));
        break;
      case 'default-audio-sink-requested':
        announce(
          t('defaultPlaybackRequested', {
            name: nodeDisplayName(event.node, t('unnamedNode')),
          }),
        );
        break;
      case 'default-audio-source-requested':
        announce(
          t('defaultInputRequested', {
            name: nodeDisplayName(event.node, t('unnamedNode')),
          }),
        );
        break;
      case 'default-audio-sink-changed':
        announce(
          event.node
            ? t('defaultPlaybackChanged', {
                name: nodeDisplayName(event.node, t('unnamedNode')),
              })
            : t('defaultPlaybackUpdated'),
        );
        break;
      case 'default-audio-source-changed':
        announce(
          event.node
            ? t('defaultInputChanged', {
                name: nodeDisplayName(event.node, t('unnamedNode')),
              })
            : t('defaultInputUpdated'),
        );
        break;
      case 'output-volume-requested':
        announce(
          t('outputVolumeRequested', {
            name: nodeDisplayName(event.node, t('unnamedNode')),
          }),
        );
        break;
      case 'output-volume-changed':
        announce(
          t('outputVolumeChanged', {
            name: nodeDisplayName(event.node, t('unnamedNode')),
          }),
        );
        break;
      case 'application-volume-remembered':
        announce(t('applicationVolumeRemembered', { name: event.name }));
        break;
      case 'operation-failed':
        showError(t(operationFailureKey(event.operation), { message: event.message }));
        break;
      case 'confirmation-timeout':
        showError(t(operationTimeoutKey(event.operation)));
        break;
    }
  }

  function operationFailureKey(operation: GraphSessionOperation): MessageKey {
    switch (operation) {
      case 'create-link':
        return 'createFailed';
      case 'remove-link':
        return 'removeFailed';
      case 'default-audio-sink':
        return 'defaultPlaybackFailed';
      case 'default-audio-source':
        return 'defaultInputFailed';
      case 'output-volume':
        return 'outputVolumeFailed';
    }
  }

  function operationTimeoutKey(operation: GraphSessionOperation): MessageKey {
    switch (operation) {
      case 'default-audio-sink':
        return 'defaultPlaybackTimeout';
      case 'default-audio-source':
        return 'defaultInputTimeout';
      case 'output-volume':
        return 'outputVolumeTimeout';
      case 'create-link':
      case 'remove-link':
        return 'confirmationTimeout';
    }
  }

  function selectLink(linkId: number | null): void {
    selectedFlowSourceId = null;
    selectedNodeId = null;
    selectedLinkId = linkId;
  }

  function selectNode(nodeId: number): void {
    selectedFlowSourceId = null;
    selectedLinkId = null;
    if (selectedNodeId === nodeId) {
      selectedNodeId = null;
      announce(t('chainCleared'));
      return;
    }
    selectedNodeId = nodeId;
    const chain = connectedChain(nodeId, graph.ports, graph.links);
    announce(
      t('chainHighlighted', {
        nodes: chain.nodeIds.size,
        links: chain.linkIds.size,
      }),
    );
  }

  function selectFlow(sourceNodeId: number): void {
    selectedLinkId = null;
    selectedNodeId = null;
    if (selectedFlowSourceId === sourceNodeId) {
      selectedFlowSourceId = null;
      announce(t('chainCleared'));
      return;
    }
    selectedFlowSourceId = sourceNodeId;
    const module = audioFlowModules.find((candidate) => candidate.source.id === sourceNodeId);
    if (module) {
      announce(
        t('flowHighlighted', {
          nodes: module.nodeIds.size,
          links: module.linkIds.size,
        }),
      );
    }
  }

  function changeWorkspaceView(view: WorkspaceId): void {
    if (workspaceView === view) return;
    workspaceView = view;
    localStorage.setItem(workspaceStorageKey, view);
    clearGraphSelection();
    session.setOutputMetering(view === 'mixer');
  }

  function openFlowBuilder(trigger: HTMLElement): void {
    flowBuilderReturnFocus = trigger;
    flowBuilderOpen = true;
  }

  function closeFlowBuilder(): void {
    flowBuilderOpen = false;
    const returnFocus = flowBuilderReturnFocus;
    flowBuilderReturnFocus = null;
    requestAnimationFrame(() => returnFocus?.focus());
  }

  function changeAdvancedMode(event: Event): void {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    advancedModeEnabled = enabled;
    localStorage.setItem(advancedModeStorageKey, String(enabled));
    if (!enabled && workspaceView === 'patchbay') changeWorkspaceView('mixer');
    announce(t(enabled ? 'customModeEnabled' : 'customModeDisabled'));
  }

  function clearGraphSelection(): void {
    selectedLinkId = null;
    selectedNodeId = null;
    selectedFlowSourceId = null;
  }

  function createLinks(connections: NormalizedPorts[]): void {
    const unique = connections.filter(
      (connection, index) =>
        connections.findIndex(
          (candidate) =>
            candidate.output.id === connection.output.id &&
            candidate.input.id === connection.input.id,
        ) === index,
    );
    for (const connection of unique) void session.createLink(connection);
  }

  function removeLink(linkId: number, policy: RoutingPolicy = 'manual-port'): void {
    removeLinks([linkId], policy);
  }

  function removeLinks(linkIds: number[], policy: RoutingPolicy): void {
    const removalIds = linkIds
      .flatMap((linkId) => linkedRemovalIds(linkId, policy))
      .filter((linkId, index, candidates) => candidates.indexOf(linkId) === index);
    for (const linkId of removalIds) void session.removeLink(linkId);
  }

  function linkedRemovalIds(linkId: number, policy: RoutingPolicy): number[] {
    const link = graph.links.find((candidate) => candidate.id === linkId);
    if (policy !== 'stereo-auto' || !link) return [linkId];
    const output = graph.ports.find((port) => port.id === link.outputPortId);
    const input = graph.ports.find((port) => port.id === link.inputPortId);
    if (!output || !input) return [linkId];

    const expanded = expandStereoConnection({ output, input }, graph.ports);
    const selectedIsAligned = expanded.some(
      (candidate) =>
        candidate.output.id === link.outputPortId && candidate.input.id === link.inputPortId,
    );
    if (expanded.length !== 2 || !selectedIsAligned) return [linkId];

    const pairIds = expanded
      .map(({ output: pairOutput, input: pairInput }) =>
        graph.links.find(
          (candidate) =>
            candidate.outputPortId === pairOutput.id && candidate.inputPortId === pairInput.id,
        ),
      )
      .filter((candidate): candidate is LinkDto => candidate !== undefined)
      .map((candidate) => candidate.id);
    return pairIds.length === 2 ? pairIds : [linkId];
  }

  function describeLink(
    link: Pick<LinkDto, 'outputPortId' | 'inputPortId'>,
    nodeOnly = false,
  ): {
    from: string;
    to: string;
    mediaType: MediaType;
  } {
    const output = graph.ports.find((port) => port.id === link.outputPortId);
    const input = graph.ports.find((port) => port.id === link.inputPortId);
    const outputNode = graph.nodes.find((node) => node.id === output?.nodeId);
    const inputNode = graph.nodes.find((node) => node.id === input?.nodeId);
    return {
      from: `${outputNode ? nodeDisplayName(outputNode, t('unnamedNode')) : t('unknown')}${
        nodeOnly ? '' : ` · ${output?.name ?? link.outputPortId}`
      }`,
      to: `${inputNode ? nodeDisplayName(inputNode, t('unnamedNode')) : t('unknown')}${
        nodeOnly ? '' : ` · ${input?.name ?? link.inputPortId}`
      }`,
      mediaType: effectiveMediaType({ ...link, mediaType: 'unknown' }, graph.ports),
    };
  }

  function changeLocale(event: Event): void {
    locale = (event.currentTarget as HTMLSelectElement).value as Locale;
    localStorage.setItem(localeStorageKey, locale);
    setDocumentLocale(locale);
  }

  function changeConnectionsExpanded(expanded: boolean): void {
    connectionsExpanded = expanded;
    localStorage.setItem(connectionPanelStorageKey, String(expanded));
  }

  function changeDefaultAudioSink(event: Event): void {
    void session.setDefaultAudioSink(Number((event.currentTarget as HTMLSelectElement).value));
  }

  function changeDefaultAudioSource(event: Event): void {
    void session.setDefaultAudioSource(Number((event.currentTarget as HTMLSelectElement).value));
  }

  function onGlobalKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (
      event.key === 'Delete' &&
      selectedLinkId !== null &&
      !target.matches('input, select, textarea')
    ) {
      event.preventDefault();
      removeLink(selectedLinkId, workspaceRoutingPolicy(workspaceView) ?? 'manual-port');
    }
  }

  onMount(() => {
    setDocumentLocale(locale);
    session.start({ outputMetering: workspaceView === 'mixer' });
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      session.stop();
      unsubscribeSessionState();
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  });
</script>

{#key locale}
  <main
    class="app-shell studio-shell"
    data-screen-label={workspaceView === 'flows'
      ? 'Audio routing'
      : workspaceView === 'mixer'
        ? 'Output mixer'
        : 'Advanced patchbay'}
    data-testid="app-shell"
  >
    <HeaderSettings
      {settingsOpen}
      {locale}
      resyncing={sessionState.resyncing}
      {t}
      onToggleSettings={() => (settingsOpen = !settingsOpen)}
      onCloseSettings={() => (settingsOpen = false)}
      onLocaleChange={changeLocale}
      onResync={() => void session.resync()}
      onMinimize={minimizeAppWindow}
      onToggleMaximize={toggleAppWindowMaximize}
      onCloseWindow={closeAppWindow}
    />

    <WorkspaceSidebar
      {workspaceView}
      {advancedModeEnabled}
      graphStatus={graph.status}
      nodeCount={graph.nodes.length}
      portCount={graph.ports.length}
      linkCount={graph.links.length}
      {t}
      onChangeWorkspace={changeWorkspaceView}
      onOpenFlowBuilder={openFlowBuilder}
    />

    <section class="workspace-region">
      {#if errorNotice}
        <div class="error-notice" role="alert" data-testid="error-notice">
          <span class="error-notice__signal" aria-hidden="true"></span>
          <p>{errorNotice}</p>
          <button type="button" onclick={() => (errorNotice = '')}>{t('dismiss')}</button>
        </div>
      {/if}

      {#if workspaceView === 'flows'}
        <AudioFlowWorkspace
          modules={audioFlowModules}
          nodes={graph.nodes}
          ports={graph.ports}
          links={graph.links}
          {pendingLinks}
          {removingLinkIds}
          status={graph.status}
          {selectedFlowSourceId}
          {focusedLinkIds}
          focusActive={graphFocusActive}
          autoStereoMatch={true}
          {t}
          onSelectFlow={selectFlow}
          onCreateLinks={createLinks}
          onRemoveLinks={(linkIds) => removeLinks(linkIds, 'stereo-auto')}
        />
      {:else if workspaceView === 'mixer'}
        <OutputVolumeWorkspace
          nodes={outputVolumeNodes}
          applications={sessionState.applicationVolumes}
          outputLevels={sessionState.outputLevels}
          defaultAudioSinkName={graph.defaultAudioSinkName}
          pendingNodeIds={pendingOutputVolumeNodeIds}
          pendingDefaultNodeId={pendingDefaultAudioSink?.nodeId ?? null}
          {t}
          onSetVolume={(nodeId, volumePercent) =>
            void session.setOutputVolume(nodeId, { volumePercent })}
          onSetMuted={(nodeId, muted) => void session.setOutputVolume(nodeId, { muted })}
          onSetDefault={(nodeId) => void session.setDefaultAudioSink(nodeId)}
          onSetApplicationVolume={(applicationId, volumePercent) =>
            session.setApplicationVolume(applicationId, { volumePercent })}
          onSetApplicationMuted={(applicationId, muted) =>
            session.setApplicationVolume(applicationId, { muted })}
        />
        <OutputSpectrum
          nodes={outputVolumeNodes}
          spectra={sessionState.outputSpectra}
          defaultAudioSinkName={graph.defaultAudioSinkName}
          {t}
        />
      {:else}
        <div class="patchbay-main">
          <TopologyWorkspace
            nodes={graph.nodes}
            ports={graph.ports}
            links={graph.links}
            {pendingLinks}
            status={graph.status}
            {selectedLinkId}
            selectedNodeId={selectedNodeId ?? selectedFlowSourceId}
            {focusedLinkIds}
            {focusedPortIds}
            {focusedNodeIds}
            focusActive={graphFocusActive}
            autoStereoMatch={false}
            {t}
            onCreateLinks={createLinks}
            onSelectLink={selectLink}
            onSelectNode={selectNode}
            onClearSelection={clearGraphSelection}
            onAnnounce={announce}
          />
        </div>
        <ConnectionPanel
          links={graph.links}
          ports={graph.ports}
          {pendingLinks}
          {removingLinkIds}
          {selectedLinkId}
          {focusedLinkIds}
          focusActive={graphFocusActive}
          expanded={connectionsExpanded}
          autoStereoMatch={false}
          {t}
          {describeLink}
          onSelectLink={selectLink}
          onRemoveLink={(linkId) => removeLink(linkId, 'manual-port')}
          onExpandedChange={changeConnectionsExpanded}
        />
      {/if}
    </section>

    {#if flowBuilderOpen}
      <AudioFlowBuilder
        nodes={graph.nodes}
        ports={graph.ports}
        links={graph.links}
        {pendingLinks}
        status={graph.status}
        {t}
        onComplete={createLinks}
        onClose={closeFlowBuilder}
      />
    {/if}

    <StatusBar
      status={graph.status}
      {defaultDevicesEditing}
      {defaultAudioSources}
      {activeDefaultAudioSource}
      {displayedDefaultAudioSource}
      {displayedDefaultAudioSourceId}
      pendingDefaultAudioSourceNodeId={pendingDefaultAudioSource?.nodeId ?? null}
      defaultAudioSourceName={graph.defaultAudioSourceName}
      {defaultAudioSinks}
      {activeDefaultAudioSink}
      {displayedDefaultAudioSink}
      {displayedDefaultAudioSinkId}
      pendingDefaultAudioSinkNodeId={pendingDefaultAudioSink?.nodeId ?? null}
      defaultAudioSinkName={graph.defaultAudioSinkName}
      {advancedModeEnabled}
      {t}
      onDefaultAudioSourceChange={changeDefaultAudioSource}
      onDefaultAudioSinkChange={changeDefaultAudioSink}
      onToggleDefaultDevicesEditing={() => (defaultDevicesEditing = !defaultDevicesEditing)}
      onAdvancedModeChange={changeAdvancedMode}
    />

    <div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
  </main>
{/key}
