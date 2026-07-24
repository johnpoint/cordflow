<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { Plus } from '@lucide/svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { onMount } from 'svelte';
  import {
    isApplicationAudioNode,
    readApplicationVolumePreferences,
    reconcileApplicationVolumes,
    updateApplicationVolumePreference,
    writeApplicationVolumePreferences,
    type ApplicationVolumeItem,
    type ApplicationVolumePreference,
  } from './lib/applicationVolume';
  import { createGraphBridge, type GraphBridge, type Unsubscribe } from './lib/bridge';
  import AudioFlowBuilder from './lib/components/AudioFlowBuilder.svelte';
  import AudioFlowWorkspace from './lib/components/AudioFlowWorkspace.svelte';
  import ConnectionPanel from './lib/components/ConnectionPanel.svelte';
  import OutputSpectrum from './lib/components/OutputSpectrum.svelte';
  import OutputVolumeWorkspace from './lib/components/OutputVolumeWorkspace.svelte';
  import TopologyWorkspace from './lib/components/TopologyWorkspace.svelte';
  import type {
    GraphEnvelope,
    LinkDto,
    MediaType,
    OperationFailure,
    OutputLevel,
  } from './lib/generated/graph';
  import { buildAudioFlowModules } from './lib/graph/audioFlow';
  import {
    connectionExists,
    connectedChain,
    effectiveMediaType,
    expandStereoConnection,
    nodeDisplayName,
    pendingHasExpired,
    type NormalizedPorts,
    type PendingLink,
  } from './lib/graph/connection';
  import { emptyGraphState, reduceEnvelope } from './lib/graph/reducer';
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

  interface PendingRemoval {
    operationId: string;
    linkId: number;
    createdAt: number;
  }

  interface PendingDefaultAudioSink {
    operationId: string;
    nodeId: number;
    nodeName: string;
    createdAt: number;
  }

  interface PendingDefaultAudioSource {
    operationId: string;
    nodeId: number;
    nodeName: string;
    createdAt: number;
  }

  interface PendingOutputVolume {
    operationId: string;
    nodeId: number;
    volumePercent: number | null;
    muted: boolean | null;
    createdAt: number;
    silent: boolean;
  }

  type OutputSpectrumChannels = Pick<OutputLevel, 'leftSpectrum' | 'rightSpectrum'>;

  const connectionPanelStorageKey = 'cordflow.connections-expanded';
  const legacyConnectionPanelStorageKey = 'helvum-next.connections-expanded';
  const localeStorageKey = 'cordflow.locale';
  const legacyLocaleStorageKey = 'helvum-next.locale';
  const bridge: GraphBridge = createGraphBridge();
  const appWindow = isTauri() ? getCurrentWindow() : null;
  let graph = emptyGraphState();
  let pendingLinks: PendingLink[] = [];
  let pendingRemovals: PendingRemoval[] = [];
  let pendingDefaultAudioSink: PendingDefaultAudioSink | null = null;
  let pendingDefaultAudioSource: PendingDefaultAudioSource | null = null;
  let pendingOutputVolumes: PendingOutputVolume[] = [];
  let queuedOutputVolumes: Record<number, number | undefined> = {};
  let outputLevels: Record<number, number | undefined> = {};
  let pendingOutputLevels: Record<number, number | undefined> = {};
  let outputSpectra: Record<number, OutputSpectrumChannels | undefined> = {};
  let pendingOutputSpectra: Record<number, OutputSpectrumChannels | undefined> = {};
  let outputLevelFrame = 0;
  let applicationVolumePreferences: ApplicationVolumePreference[] =
    readApplicationVolumePreferences(localStorage);
  applicationVolumePreferences = writeApplicationVolumePreferences(
    localStorage,
    applicationVolumePreferences,
  );
  let applicationVolumes: ApplicationVolumeItem[] = reconcileApplicationVolumes(
    applicationVolumePreferences,
    [],
    [],
  ).applications;
  const observedApplicationNodeIds = new SvelteSet<number>();
  let selectedLinkId: number | null = null;
  let selectedNodeId: number | null = null;
  let selectedFlowSourceId: number | null = null;
  let announcement = '';
  let errorNotice = '';
  let resyncing = false;
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

  function minimizeAppWindow(): void {
    void appWindow?.minimize();
  }

  function toggleAppWindowMaximize(): void {
    void appWindow?.toggleMaximize();
  }

  function closeAppWindow(): void {
    void appWindow?.close();
  }

  $: removingLinkIds = new Set(pendingRemovals.map((removal) => removal.linkId));
  $: audioFlowModules = buildAudioFlowModules(graph.nodes, graph.ports, graph.links);
  $: defaultAudioSinks = graph.nodes
    .filter(
      (node) =>
        node.objectName &&
        graph.ports.some(
          (port) =>
            port.nodeId === node.id && port.direction === 'input' && port.mediaType === 'audio',
        ),
    )
    .sort((left, right) =>
      nodeDisplayName(left, t('unnamedNode')).localeCompare(
        nodeDisplayName(right, t('unnamedNode')),
        locale,
      ),
    );
  $: activeDefaultAudioSink =
    defaultAudioSinks.find((node) => node.objectName === graph.defaultAudioSinkName) ?? null;
  $: displayedDefaultAudioSinkId =
    pendingDefaultAudioSink?.nodeId ?? activeDefaultAudioSink?.id ?? '';
  $: displayedDefaultAudioSink =
    defaultAudioSinks.find((node) => node.id === displayedDefaultAudioSinkId) ??
    activeDefaultAudioSink;
  $: defaultAudioSources = graph.nodes
    .filter(
      (node) =>
        node.objectName &&
        (node.mediaClass === 'Audio/Source' || node.mediaClass?.startsWith('Audio/Source/')) &&
        graph.ports.some(
          (port) =>
            port.nodeId === node.id && port.direction === 'output' && port.mediaType === 'audio',
        ),
    )
    .sort((left, right) =>
      nodeDisplayName(left, t('unnamedNode')).localeCompare(
        nodeDisplayName(right, t('unnamedNode')),
        locale,
      ),
    );
  $: activeDefaultAudioSource =
    defaultAudioSources.find((node) => node.objectName === graph.defaultAudioSourceName) ?? null;
  $: displayedDefaultAudioSourceId =
    pendingDefaultAudioSource?.nodeId ?? activeDefaultAudioSource?.id ?? '';
  $: displayedDefaultAudioSource =
    defaultAudioSources.find((node) => node.id === displayedDefaultAudioSourceId) ??
    activeDefaultAudioSource;
  $: outputVolumeNodes = graph.nodes
    .filter(
      (node) =>
        node.objectName &&
        (node.mediaClass === 'Audio/Sink' || node.mediaClass?.startsWith('Audio/Sink/')) &&
        graph.ports.some(
          (port) =>
            port.nodeId === node.id && port.direction === 'input' && port.mediaType === 'audio',
        ),
    )
    .sort((left, right) =>
      nodeDisplayName(left, t('unnamedNode')).localeCompare(
        nodeDisplayName(right, t('unnamedNode')),
        locale,
      ),
    );
  $: pendingOutputVolumeNodeIds = new Set(pendingOutputVolumes.map((pending) => pending.nodeId));
  $: selectedFlow =
    audioFlowModules.find((module) => module.source.id === selectedFlowSourceId) ?? null;
  $: selectedLink = graph.links.find((link) => link.id === selectedLinkId) ?? null;
  $: selectedChain =
    selectedNodeId === null
      ? {
          nodeIds: new Set<number>(),
          portIds: new Set<number>(),
          linkIds: new Set<number>(),
        }
      : connectedChain(selectedNodeId, graph.ports, graph.links);
  $: selectedLinkPortIds = new Set(
    selectedLink ? [selectedLink.outputPortId, selectedLink.inputPortId] : [],
  );
  $: selectedLinkNodeIds = new Set(
    graph.ports.filter((port) => selectedLinkPortIds.has(port.id)).map((port) => port.nodeId),
  );
  $: focusedLinkIds = selectedFlow
    ? selectedFlow.linkIds
    : selectedNodeId === null
      ? new Set(selectedLink ? [selectedLink.id] : [])
      : selectedChain.linkIds;
  $: focusedPortIds = selectedFlow
    ? selectedFlow.portIds
    : selectedNodeId === null
      ? selectedLinkPortIds
      : selectedChain.portIds;
  $: focusedNodeIds = selectedFlow
    ? selectedFlow.nodeIds
    : selectedNodeId === null
      ? selectedLinkNodeIds
      : selectedChain.nodeIds;
  $: graphFocusActive = selectedFlow !== null || selectedNodeId !== null || selectedLink !== null;
  $: if (
    selectedFlowSourceId !== null &&
    !audioFlowModules.some((module) => module.source.id === selectedFlowSourceId)
  ) {
    selectedFlowSourceId = null;
  }

  function t(key: MessageKey, values: Record<string, string | number> = {}): string {
    return translate(locale, key, values);
  }

  function operationId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  }

  function announce(message: string): void {
    announcement = '';
    requestAnimationFrame(() => (announcement = message));
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
    syncOutputMetering(view === 'mixer');
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

  function onOutputLevel(level: OutputLevel): void {
    pendingOutputLevels[level.nodeId] = level.peak;
    pendingOutputSpectra[level.nodeId] = {
      leftSpectrum: level.leftSpectrum,
      rightSpectrum: level.rightSpectrum,
    };
    if (outputLevelFrame !== 0) return;
    outputLevelFrame = requestAnimationFrame(() => {
      outputLevels = { ...outputLevels, ...pendingOutputLevels };
      outputSpectra = { ...outputSpectra, ...pendingOutputSpectra };
      pendingOutputLevels = {};
      pendingOutputSpectra = {};
      outputLevelFrame = 0;
    });
  }

  function syncOutputMetering(enabled: boolean): void {
    void bridge.setOutputMetering(enabled).catch((error) => {
      console.warn('Could not update PipeWire output metering state', error);
    });
  }

  function reconcileApplicationVolumeState(now = Date.now()): void {
    const reconciliation = reconcileApplicationVolumes(
      applicationVolumePreferences,
      graph.nodes,
      graph.ports,
      now,
    );
    applicationVolumePreferences = writeApplicationVolumePreferences(
      localStorage,
      reconciliation.preferences,
      now,
    );
    applicationVolumes = reconciliation.applications;

    const currentNodeIds = new Set(graph.nodes.map((node) => node.id));
    for (const nodeId of observedApplicationNodeIds) {
      if (!currentNodeIds.has(nodeId)) observedApplicationNodeIds.delete(nodeId);
    }

    for (const application of applicationVolumes) {
      for (const nodeId of application.nodeIds) {
        if (
          reconciliation.rememberedNodeIds.includes(nodeId) &&
          !observedApplicationNodeIds.has(nodeId)
        ) {
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          if (
            node &&
            (node.volumePercent !== application.volumePercent || node.muted !== application.muted)
          ) {
            queueMicrotask(() => {
              void setOutputVolume(
                nodeId,
                {
                  volumePercent: application.volumePercent,
                  muted: application.muted,
                },
                true,
              );
            });
          }
        }
        observedApplicationNodeIds.add(nodeId);
      }
    }
  }

  function setApplicationVolume(
    applicationId: string,
    update: { volumePercent?: number; muted?: boolean },
  ): void {
    const now = Date.now();
    applicationVolumePreferences = writeApplicationVolumePreferences(
      localStorage,
      updateApplicationVolumePreference(applicationVolumePreferences, applicationId, update, now),
      now,
    );
    const reconciliation = reconcileApplicationVolumes(
      applicationVolumePreferences,
      graph.nodes,
      graph.ports,
      now,
    );
    applicationVolumePreferences = reconciliation.preferences;
    applicationVolumes = reconciliation.applications;
    const application = applicationVolumes.find((candidate) => candidate.id === applicationId);
    if (!application) return;
    for (const nodeId of application.nodeIds) {
      void setOutputVolume(nodeId, update);
    }
    if (!application.active) {
      announce(t('applicationVolumeRemembered', { name: application.name }));
    }
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

  function onEnvelope(envelope: GraphEnvelope): void {
    const previousGeneration = graph.generation;
    const previousStatus = graph.status.state;
    const previousDefaultAudioSinkName = graph.defaultAudioSinkName;
    const previousDefaultAudioSourceName = graph.defaultAudioSourceName;
    const previousLinkIds = new Set(graph.links.map((link) => link.id));
    const result = reduceEnvelope(graph, envelope);
    if (result.needsResync) {
      showError(t('graphGap'));
      void resyncGraph(false);
      return;
    }
    if (!result.applied) return;
    graph = result.state;
    pendingLinks = pendingLinks.filter(
      (pending) =>
        !graph.links.some(
          (link) =>
            link.outputPortId === pending.outputPortId && link.inputPortId === pending.inputPortId,
        ),
    );
    pendingRemovals = pendingRemovals.filter((pending) =>
      graph.links.some((link) => link.id === pending.linkId),
    );
    if (selectedLinkId !== null && !graph.links.some((link) => link.id === selectedLinkId)) {
      selectedLinkId = null;
    }
    if (selectedNodeId !== null && !graph.nodes.some((node) => node.id === selectedNodeId)) {
      selectedNodeId = null;
    }
    if (
      selectedFlowSourceId !== null &&
      !graph.nodes.some((node) => node.id === selectedFlowSourceId)
    ) {
      selectedFlowSourceId = null;
    }

    if (graph.generation !== previousGeneration) {
      pendingLinks = pendingLinks.filter((link) => link.generation === graph.generation);
      pendingRemovals = [];
      pendingDefaultAudioSink = null;
      pendingDefaultAudioSource = null;
      pendingOutputVolumes = [];
      queuedOutputVolumes = {};
      outputLevels = {};
      pendingOutputLevels = {};
      outputSpectra = {};
      pendingOutputSpectra = {};
      selectedLinkId = null;
      selectedNodeId = null;
      selectedFlowSourceId = null;
      observedApplicationNodeIds.clear();
    }
    reconcileApplicationVolumeState();
    if (result.operationFailure) handleOperationFailure(result.operationFailure);

    if (envelope.payload.type === 'delta' && envelope.payload.data.type === 'linkAdded') {
      const link = envelope.payload.data.data;
      const matching = pendingLinks.some(
        (pending) =>
          pending.outputPortId === link.outputPortId && pending.inputPortId === link.inputPortId,
      );
      pendingLinks = pendingLinks.filter(
        (pending) =>
          pending.outputPortId !== link.outputPortId || pending.inputPortId !== link.inputPortId,
      );
      if (matching || !previousLinkIds.has(link.id)) announce(t('linkCreated'));
    }

    if (envelope.payload.type === 'delta' && envelope.payload.data.type === 'linkRemoved') {
      const removedId = envelope.payload.data.data.id;
      pendingRemovals = pendingRemovals.filter((removal) => removal.linkId !== removedId);
      if (selectedLinkId === removedId) selectedLinkId = null;
      announce(t('linkRemoved'));
    }

    if (envelope.payload.type === 'delta' && envelope.payload.data.type === 'nodeUpdated') {
      const node = envelope.payload.data.data;
      const confirmed = pendingOutputVolumes.filter(
        (pending) =>
          pending.nodeId === node.id &&
          (pending.volumePercent === null || pending.volumePercent === node.volumePercent) &&
          (pending.muted === null || pending.muted === node.muted),
      );
      if (confirmed.length > 0) {
        pendingOutputVolumes = pendingOutputVolumes.filter(
          (pending) => !confirmed.includes(pending),
        );
        if (confirmed.some((pending) => pending.muted !== null)) {
          if (confirmed.some((pending) => !pending.silent)) {
            announce(
              t('outputVolumeChanged', {
                name: nodeDisplayName(node, t('unnamedNode')),
              }),
            );
          }
        }
        if (!pendingOutputVolumes.some((pending) => pending.nodeId === node.id)) {
          const queuedVolume = queuedOutputVolumes[node.id];
          if (queuedVolume !== undefined) {
            clearQueuedOutputVolume(node.id);
            if (queuedVolume !== node.volumePercent) {
              void setOutputVolume(node.id, { volumePercent: queuedVolume });
            }
          }
        }
      }
    }

    if (
      envelope.payload.type === 'delta' &&
      envelope.payload.data.type === 'defaultAudioSinkChanged' &&
      graph.defaultAudioSinkName !== previousDefaultAudioSinkName
    ) {
      const defaultNode = graph.nodes.find(
        (node) => node.objectName === graph.defaultAudioSinkName,
      );
      if (pendingDefaultAudioSink?.nodeName === graph.defaultAudioSinkName) {
        pendingDefaultAudioSink = null;
      }
      announce(
        defaultNode
          ? t('defaultPlaybackChanged', {
              name: nodeDisplayName(defaultNode, t('unnamedNode')),
            })
          : t('defaultPlaybackUpdated'),
      );
    }

    if (
      envelope.payload.type === 'delta' &&
      envelope.payload.data.type === 'defaultAudioSourceChanged' &&
      graph.defaultAudioSourceName !== previousDefaultAudioSourceName
    ) {
      const defaultNode = graph.nodes.find(
        (node) => node.objectName === graph.defaultAudioSourceName,
      );
      if (pendingDefaultAudioSource?.nodeName === graph.defaultAudioSourceName) {
        pendingDefaultAudioSource = null;
      }
      announce(
        defaultNode
          ? t('defaultInputChanged', {
              name: nodeDisplayName(defaultNode, t('unnamedNode')),
            })
          : t('defaultInputUpdated'),
      );
    }

    if (
      previousGeneration >= 0 &&
      previousStatus !== 'connected' &&
      graph.status.state === 'connected'
    ) {
      announce(t('backendReconnected'));
    } else if (graph.status.state === 'disconnected') {
      announce(t('backendUnavailable'));
    }
  }

  function handleOperationFailure(failure: OperationFailure): void {
    const isCreation = pendingLinks.some((pending) => pending.operationId === failure.operationId);
    const isRemoval = pendingRemovals.some(
      (pending) => pending.operationId === failure.operationId,
    );
    const isDefaultAudioSink = pendingDefaultAudioSink?.operationId === failure.operationId;
    const isDefaultAudioSource = pendingDefaultAudioSource?.operationId === failure.operationId;
    const failedOutputVolume = pendingOutputVolumes.find(
      (pending) => pending.operationId === failure.operationId,
    );
    const isOutputVolume = failedOutputVolume !== undefined;
    if (
      !isCreation &&
      !isRemoval &&
      !isDefaultAudioSink &&
      !isDefaultAudioSource &&
      !isOutputVolume
    ) {
      return;
    }
    pendingLinks = pendingLinks.filter((pending) => pending.operationId !== failure.operationId);
    pendingRemovals = pendingRemovals.filter(
      (pending) => pending.operationId !== failure.operationId,
    );
    if (isDefaultAudioSink) pendingDefaultAudioSink = null;
    if (isDefaultAudioSource) pendingDefaultAudioSource = null;
    if (isOutputVolume) {
      pendingOutputVolumes = pendingOutputVolumes.filter(
        (pending) => pending.operationId !== failure.operationId,
      );
      clearQueuedOutputVolume(failedOutputVolume.nodeId);
    }
    const messageKey = isOutputVolume
      ? 'outputVolumeFailed'
      : isDefaultAudioSource
        ? 'defaultInputFailed'
        : isDefaultAudioSink
          ? 'defaultPlaybackFailed'
          : isRemoval
            ? 'removeFailed'
            : 'createFailed';
    showError(t(messageKey, { message: failure.message }));
  }

  function showError(message: string): void {
    errorNotice = message;
  }

  async function resyncGraph(announceProgress = true): Promise<void> {
    if (resyncing) return;
    resyncing = true;
    if (announceProgress) announce(t('resyncing'));
    try {
      onEnvelope(await bridge.getGraphSnapshot());
      if (announceProgress) announce(t('resynced'));
    } catch (error) {
      showError(t('graphReadFailed', { message: errorMessage(error) }));
    } finally {
      resyncing = false;
    }
  }

  async function createLink(ports: NormalizedPorts): Promise<void> {
    if (connectionExists(graph.links, pendingLinks, ports.output.id, ports.input.id)) {
      return;
    }
    const pending: PendingLink = {
      operationId: operationId('create'),
      generation: graph.generation,
      outputPortId: ports.output.id,
      inputPortId: ports.input.id,
      createdAt: Date.now(),
    };
    pendingLinks = [...pendingLinks, pending];
    announce(t('linkRequested'));
    try {
      await bridge.createLink({
        operationId: pending.operationId,
        generation: pending.generation,
        outputPortId: pending.outputPortId,
        inputPortId: pending.inputPortId,
      });
    } catch (error) {
      pendingLinks = pendingLinks.filter(
        (candidate) => candidate.operationId !== pending.operationId,
      );
      showError(t('createFailed', { message: errorMessage(error) }));
    }
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
    for (const connection of unique) void createLink(connection);
  }

  function removeLink(linkId: number, policy: RoutingPolicy = 'manual-port'): void {
    removeLinks([linkId], policy);
  }

  function removeLinks(linkIds: number[], policy: RoutingPolicy): void {
    const removalIds = linkIds
      .flatMap((linkId) => linkedRemovalIds(linkId, policy))
      .filter((linkId, index, candidates) => candidates.indexOf(linkId) === index);
    for (const linkId of removalIds) void removeSingleLink(linkId);
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

  async function removeSingleLink(linkId: number): Promise<void> {
    if (pendingRemovals.some((removal) => removal.linkId === linkId)) return;
    const pending: PendingRemoval = {
      operationId: operationId('remove'),
      linkId,
      createdAt: Date.now(),
    };
    pendingRemovals = [...pendingRemovals, pending];
    try {
      await bridge.removeLink({
        operationId: pending.operationId,
        generation: graph.generation,
        linkId,
      });
    } catch (error) {
      pendingRemovals = pendingRemovals.filter(
        (candidate) => candidate.operationId !== pending.operationId,
      );
      showError(t('removeFailed', { message: errorMessage(error) }));
    }
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
    const nodeId = Number((event.currentTarget as HTMLSelectElement).value);
    void setDefaultAudioSink(nodeId);
  }

  async function setDefaultAudioSink(nodeId: number): Promise<void> {
    const node = defaultAudioSinks.find((candidate) => candidate.id === nodeId);
    if (!node?.objectName || node.objectName === graph.defaultAudioSinkName) return;

    const pending: PendingDefaultAudioSink = {
      operationId: operationId('default-sink'),
      nodeId: node.id,
      nodeName: node.objectName,
      createdAt: Date.now(),
    };
    pendingDefaultAudioSink = pending;
    announce(t('defaultPlaybackRequested', { name: nodeDisplayName(node, t('unnamedNode')) }));
    try {
      await bridge.setDefaultAudioSink({
        operationId: pending.operationId,
        generation: graph.generation,
        nodeId: pending.nodeId,
      });
    } catch (error) {
      if (pendingDefaultAudioSink?.operationId === pending.operationId) {
        pendingDefaultAudioSink = null;
        showError(t('defaultPlaybackFailed', { message: errorMessage(error) }));
      }
    }
  }

  async function changeDefaultAudioSource(event: Event): Promise<void> {
    const nodeId = Number((event.currentTarget as HTMLSelectElement).value);
    const node = defaultAudioSources.find((candidate) => candidate.id === nodeId);
    if (!node?.objectName || node.objectName === graph.defaultAudioSourceName) return;

    const pending: PendingDefaultAudioSource = {
      operationId: operationId('default-source'),
      nodeId: node.id,
      nodeName: node.objectName,
      createdAt: Date.now(),
    };
    pendingDefaultAudioSource = pending;
    announce(t('defaultInputRequested', { name: nodeDisplayName(node, t('unnamedNode')) }));
    try {
      await bridge.setDefaultAudioSource({
        operationId: pending.operationId,
        generation: graph.generation,
        nodeId: pending.nodeId,
      });
    } catch (error) {
      if (pendingDefaultAudioSource?.operationId === pending.operationId) {
        pendingDefaultAudioSource = null;
        showError(t('defaultInputFailed', { message: errorMessage(error) }));
      }
    }
  }

  async function setOutputVolume(
    nodeId: number,
    update: { volumePercent?: number; muted?: boolean },
    silent = false,
  ): Promise<void> {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    const isAudioSink =
      node &&
      (node.mediaClass === 'Audio/Sink' || node.mediaClass?.startsWith('Audio/Sink/')) &&
      graph.ports.some(
        (port) =>
          port.nodeId === node.id && port.direction === 'input' && port.mediaType === 'audio',
      );
    const isApplicationOutput =
      node &&
      isApplicationAudioNode(node) &&
      graph.ports.some(
        (port) =>
          port.nodeId === node.id && port.direction === 'output' && port.mediaType === 'audio',
      );
    if (!node || (!isAudioSink && !isApplicationOutput)) return;
    const activeRequest = pendingOutputVolumes.find((pending) => pending.nodeId === nodeId);
    if (activeRequest) {
      if (update.volumePercent !== undefined) {
        if (update.volumePercent !== activeRequest.volumePercent) {
          queuedOutputVolumes = {
            ...queuedOutputVolumes,
            [nodeId]: update.volumePercent,
          };
        } else if (queuedOutputVolumes[nodeId] !== undefined) {
          clearQueuedOutputVolume(nodeId);
        }
      }
      return;
    }
    if (
      update.volumePercent !== undefined &&
      update.muted === undefined &&
      update.volumePercent === node.volumePercent
    ) {
      return;
    }
    const pending: PendingOutputVolume = {
      operationId: operationId('output-volume'),
      nodeId,
      volumePercent: update.volumePercent ?? null,
      muted: update.muted ?? null,
      createdAt: Date.now(),
      silent,
    };
    pendingOutputVolumes = [...pendingOutputVolumes, pending];
    if (update.muted !== undefined && !silent) {
      announce(
        t('outputVolumeRequested', {
          name: nodeDisplayName(node, t('unnamedNode')),
        }),
      );
    }
    try {
      await bridge.setOutputVolume({
        operationId: pending.operationId,
        generation: graph.generation,
        nodeId,
        volumePercent: pending.volumePercent,
        muted: pending.muted,
      });
    } catch (error) {
      if (pendingOutputVolumes.some((candidate) => candidate.operationId === pending.operationId)) {
        pendingOutputVolumes = pendingOutputVolumes.filter(
          (candidate) => candidate.operationId !== pending.operationId,
        );
        clearQueuedOutputVolume(nodeId);
        showError(t('outputVolumeFailed', { message: errorMessage(error) }));
      }
    }
  }

  function clearQueuedOutputVolume(nodeId: number): void {
    if (queuedOutputVolumes[nodeId] === undefined) return;
    const nextQueue = { ...queuedOutputVolumes };
    delete nextQueue[nodeId];
    queuedOutputVolumes = nextQueue;
  }

  function errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'message' in error) return String(error.message);
    return String(error);
  }

  function checkPendingTimeouts(): void {
    const now = Date.now();
    const expiredLinks = pendingLinks.filter((pending) => pendingHasExpired(pending, now));
    const expiredRemovals = pendingRemovals.filter((pending) => now - pending.createdAt >= 5_000);
    const defaultAudioSinkExpired =
      pendingDefaultAudioSink !== null && now - pendingDefaultAudioSink.createdAt >= 5_000;
    const defaultAudioSourceExpired =
      pendingDefaultAudioSource !== null && now - pendingDefaultAudioSource.createdAt >= 5_000;
    const expiredOutputVolumes = pendingOutputVolumes.filter(
      (pending) => now - pending.createdAt >= 5_000,
    );
    if (
      expiredLinks.length === 0 &&
      expiredRemovals.length === 0 &&
      !defaultAudioSinkExpired &&
      !defaultAudioSourceExpired &&
      expiredOutputVolumes.length === 0
    ) {
      return;
    }
    pendingLinks = pendingLinks.filter((pending) => !expiredLinks.includes(pending));
    pendingRemovals = pendingRemovals.filter((pending) => !expiredRemovals.includes(pending));
    if (defaultAudioSinkExpired) pendingDefaultAudioSink = null;
    if (defaultAudioSourceExpired) pendingDefaultAudioSource = null;
    pendingOutputVolumes = pendingOutputVolumes.filter(
      (pending) => !expiredOutputVolumes.includes(pending),
    );
    if (expiredOutputVolumes.length > 0) {
      const expiredNodeIds = expiredOutputVolumes.map((pending) => pending.nodeId);
      const nextQueue = { ...queuedOutputVolumes };
      for (const nodeId of expiredNodeIds) delete nextQueue[nodeId];
      queuedOutputVolumes = nextQueue;
    }
    showError(
      t(
        expiredOutputVolumes.length > 0
          ? 'outputVolumeTimeout'
          : defaultAudioSourceExpired
            ? 'defaultInputTimeout'
            : defaultAudioSinkExpired
              ? 'defaultPlaybackTimeout'
              : 'confirmationTimeout',
      ),
    );
    void resyncGraph(false);
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
    let unsubscribe: Unsubscribe | undefined;
    let unsubscribeOutputLevels: Unsubscribe | undefined;
    void bridge
      .subscribe(onEnvelope)
      .then((stop) => (unsubscribe = stop))
      .catch((error) => showError(t('graphReadFailed', { message: errorMessage(error) })));
    void bridge
      .subscribeOutputLevels(onOutputLevel)
      .then((stop) => {
        unsubscribeOutputLevels = stop;
        syncOutputMetering(workspaceView === 'mixer');
      })
      .catch((error) => console.warn('Could not subscribe to PipeWire output levels', error));
    const timer = window.setInterval(checkPendingTimeouts, 250);
    const applicationMemoryTimer = window.setInterval(
      () => reconcileApplicationVolumeState(),
      60_000,
    );
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      unsubscribe?.();
      unsubscribeOutputLevels?.();
      syncOutputMetering(false);
      if (outputLevelFrame !== 0) cancelAnimationFrame(outputLevelFrame);
      window.clearInterval(timer);
      window.clearInterval(applicationMemoryTimer);
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
          onclick={() => (settingsOpen = !settingsOpen)}
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
            onclick={minimizeAppWindow}
          >
            <span aria-hidden="true">[-]</span>
          </button>
          <button
            class="app-window-control"
            type="button"
            aria-label={t('maximizeWindow')}
            title={t('maximizeWindow')}
            data-testid="window-maximize"
            onclick={toggleAppWindowMaximize}
          >
            <span aria-hidden="true">[□]</span>
          </button>
          <button
            class="app-window-control app-window-control--close"
            type="button"
            aria-label={t('closeWindow')}
            title={t('closeWindow')}
            data-testid="window-close"
            onclick={closeAppWindow}
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
              onclick={() => (settingsOpen = false)}
            >
              <span class="ascii-icon" aria-hidden="true">[x]</span>
            </button>
          </header>
          <label class="settings-menu__row">
            <span><span class="ascii-icon" aria-hidden="true">[A]</span>{t('language')}</span>
            <select value={locale} onchange={changeLocale} aria-label={t('language')}>
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
          <button
            class="button settings-menu__action"
            type="button"
            disabled={resyncing}
            onclick={() => resyncGraph()}
          >
            <span class="ascii-icon" aria-hidden="true">[r]</span>
            {t(resyncing ? 'resyncing' : 'refresh')}
          </button>
        </div>
      {/if}
    </header>

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
          onclick={() => changeWorkspaceView('mixer')}
        >
          <span class="workspace-nav__marker" aria-hidden="true">[=]</span>
          <span
            ><strong>{t('outputVolumes')}</strong><small>{t('outputMixerDescription')}</small></span
          >
        </button>
        <button
          class:workspace-nav__item--active={workspaceView === 'flows'}
          class="workspace-nav__item"
          type="button"
          aria-current={workspaceView === 'flows' ? 'page' : undefined}
          aria-pressed={workspaceView === 'flows'}
          data-testid="view-audio-flows"
          onclick={() => changeWorkspaceView('flows')}
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
            onclick={() => changeWorkspaceView('patchbay')}
          >
            <span class="workspace-nav__marker" aria-hidden="true">[:]</span>
            <span
              ><strong>{t('advancedPatchbay')}</strong><small>{t('patchbayDescription')}</small
              ></span
            >
          </button>
        {/if}
      </nav>
      {#if workspaceView === 'patchbay'}
        <div
          class="workspace-sidebar__metrics"
          aria-label={t('graphSummary')}
          data-testid="patchbay-metrics"
        >
          <span>{t('nodesCount', { count: graph.nodes.length })}</span>
          <span>{t('portsCount', { count: graph.ports.length })}</span>
          <span>{t('linksCount', { count: graph.links.length })}</span>
        </div>
      {/if}
      {#if workspaceView === 'flows'}
        <button
          class="button button--small workspace-sidebar__action"
          type="button"
          disabled={graph.status.state !== 'connected'}
          data-testid="flow-builder-open"
          onclick={(event) => openFlowBuilder(event.currentTarget)}
        >
          <Plus size={15} aria-hidden="true" />{t('createAudioFlow')}
        </button>
      {/if}
    </aside>

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
          applications={applicationVolumes}
          {outputLevels}
          defaultAudioSinkName={graph.defaultAudioSinkName}
          pendingNodeIds={pendingOutputVolumeNodeIds}
          pendingDefaultNodeId={pendingDefaultAudioSink?.nodeId ?? null}
          {t}
          onSetVolume={(nodeId, volumePercent) => void setOutputVolume(nodeId, { volumePercent })}
          onSetMuted={(nodeId, muted) => void setOutputVolume(nodeId, { muted })}
          onSetDefault={(nodeId) => void setDefaultAudioSink(nodeId)}
          onSetApplicationVolume={(applicationId, volumePercent) =>
            setApplicationVolume(applicationId, { volumePercent })}
          onSetApplicationMuted={(applicationId, muted) =>
            setApplicationVolume(applicationId, { muted })}
        />
        <OutputSpectrum
          nodes={outputVolumeNodes}
          spectra={outputSpectra}
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

    <footer class="app-statusbar" data-testid="app-statusbar">
      <span class={`status-chip status-chip--${graph.status.state}`} data-testid="graph-status">
        <i aria-hidden="true"></i>{t(graph.status.state)}
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
              disabled={graph.status.state !== 'connected' ||
                defaultAudioSources.length === 0 ||
                pendingDefaultAudioSource !== null}
              aria-label={t('defaultInputDevice')}
              onchange={(event) => void changeDefaultAudioSource(event)}
            >
              {#if !activeDefaultAudioSource && !pendingDefaultAudioSource}
                <option value="">{t('defaultInputUnknown')}</option>
              {/if}
              {#each defaultAudioSources as node (node.id)}
                <option value={node.id}>
                  {nodeDisplayName(node, t('unnamedNode'))}
                  {node.objectName === graph.defaultAudioSourceName
                    ? ` · ${t('currentDefault')}`
                    : ''}
                </option>
              {/each}
            </select>
            {#if pendingDefaultAudioSource}
              <span class="default-device-control__pending">{t('applying')}</span>
            {/if}
          </label>
          <label class="default-device-control" data-testid="default-playback-control">
            <span>{t('defaultPlaybackDevice')}</span>
            <select
              value={displayedDefaultAudioSinkId}
              disabled={graph.status.state !== 'connected' ||
                defaultAudioSinks.length === 0 ||
                pendingDefaultAudioSink !== null}
              aria-label={t('defaultPlaybackDevice')}
              onchange={(event) => void changeDefaultAudioSink(event)}
            >
              {#if !activeDefaultAudioSink && !pendingDefaultAudioSink}
                <option value="">{t('defaultPlaybackUnknown')}</option>
              {/if}
              {#each defaultAudioSinks as node (node.id)}
                <option value={node.id}>
                  {nodeDisplayName(node, t('unnamedNode'))}
                  {node.objectName === graph.defaultAudioSinkName
                    ? ` · ${t('currentDefault')}`
                    : ''}
                </option>
              {/each}
            </select>
            {#if pendingDefaultAudioSink}
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
            {#if pendingDefaultAudioSource}
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
            {#if pendingDefaultAudioSink}
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
        onclick={() => (defaultDevicesEditing = !defaultDevicesEditing)}
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
          onchange={changeAdvancedMode}
        />
        <span class="custom-mode-switch__track" aria-hidden="true"><i></i></span>
        <strong>{t(advancedModeEnabled ? 'enabled' : 'disabled')}</strong>
      </label>
    </footer>

    <div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
  </main>
{/key}
