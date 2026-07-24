<script lang="ts">
  import type { GraphStatus, LinkDto, NodeDto, PortDto } from '../generated/graph';
  import type { AudioFlowModule, AudioFlowPath } from '../graph/audioFlow';
  import {
    compatibleTargetIds,
    connectionExists,
    expandStereoConnection,
    nodeDisplayName,
    normalizePorts,
    stableNodeSort,
    type NormalizedPorts,
    type PendingLink,
  } from '../graph/connection';
  import type { MessageKey } from '../i18n';
  import PortChooserDialog from './PortChooserDialog.svelte';

  interface PortGroup {
    node: NodeDto;
    ports: PortDto[];
  }

  export let modules: AudioFlowModule[];
  export let nodes: NodeDto[];
  export let ports: PortDto[];
  export let links: LinkDto[];
  export let pendingLinks: PendingLink[];
  export let removingLinkIds: Set<number>;
  export let status: GraphStatus;
  export let selectedFlowSourceId: number | null;
  export let focusedLinkIds: Set<number>;
  export let focusActive: boolean;
  export let autoStereoMatch: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onSelectFlow: (sourceNodeId: number) => void;
  export let onCreateLinks: (ports: NormalizedPorts[]) => void;
  export let onRemoveLinks: (linkIds: number[]) => void;

  let editingSourceId: number | null = null;
  let selectedOutputPortId: number | null = null;
  let selectedInputPortId: number | null = null;
  let chooserMode: 'output' | 'input' | null = null;
  let chooserReturnFocus: HTMLElement | null = null;
  $: editingModule =
    editingSourceId === null
      ? null
      : (modules.find((module) => module.source.id === editingSourceId) ?? null);
  $: editorOutputPorts = editingModule ? outputPortsFor(editingModule) : [];
  $: if (
    selectedOutputPortId === null ||
    !editorOutputPorts.some((port) => port.id === selectedOutputPortId)
  ) {
    selectedOutputPortId = editingModule ? (defaultOutputPortFor(editingModule)?.id ?? null) : null;
  }
  $: selectedOutput =
    selectedOutputPortId === null
      ? null
      : (ports.find((port) => port.id === selectedOutputPortId) ?? null);
  $: selectedOutputNode =
    selectedOutput === null
      ? null
      : (nodes.find((node) => node.id === selectedOutput.nodeId) ?? null);
  $: selectedInput =
    selectedInputPortId === null
      ? null
      : (ports.find((port) => port.id === selectedInputPortId) ?? null);
  $: compatibleInputIds = selectedOutput
    ? compatibleTargetIds(selectedOutput, ports, links, pendingLinks)
    : new Set<number>();
  $: editorInputPorts = ports
    .filter(
      (port) =>
        port.direction === 'input' &&
        (port.mediaType === 'audio' || port.mediaType === 'unknown') &&
        compatibleInputIds.has(port.id),
    )
    .sort(comparePorts);
  $: if (
    selectedInputPortId !== null &&
    !editorInputPorts.some((port) => port.id === selectedInputPortId)
  ) {
    selectedInputPortId = null;
  }
  $: outputPortGroups = groupPorts(editorOutputPorts);
  $: inputPortGroups = groupPorts(editorInputPorts);
  $: automaticInputPortGroups = inputPortGroups
    .map((group) => ({
      ...group,
      ports: group.ports.filter(
        (port) =>
          port.nodeId !== selectedOutput?.nodeId && missingAutomaticConnections(port).length > 0,
      ),
    }))
    .filter((group) => group.ports.length > 0);
  $: availableInputCount = autoStereoMatch
    ? automaticInputPortGroups.length
    : editorInputPorts.length;
  $: if (autoStereoMatch && selectedInputPortId !== null) selectedInputPortId = null;
  $: if (editingSourceId !== null && editingModule === null) closeConnectionEditor();

  function displayName(node: NodeDto): string {
    return nodeDisplayName(node, t('unnamedNode'));
  }

  function comparePorts(left: PortDto, right: PortDto): number {
    const leftNode = nodes.find((node) => node.id === left.nodeId);
    const rightNode = nodes.find((node) => node.id === right.nodeId);
    if (leftNode && rightNode) {
      const nodeOrder = stableNodeSort(leftNode, rightNode);
      if (nodeOrder !== 0) return nodeOrder;
    }
    return left.name.localeCompare(right.name, 'en', { numeric: true }) || left.id - right.id;
  }

  function outputPortsFor(module: AudioFlowModule): PortDto[] {
    return ports
      .filter(
        (port) =>
          module.nodeIds.has(port.nodeId) &&
          port.direction === 'output' &&
          (port.mediaType === 'audio' || port.mediaType === 'unknown'),
      )
      .sort((left, right) => {
        const leftRank = left.nodeId === module.source.id ? 0 : 1;
        const rightRank = right.nodeId === module.source.id ? 0 : 1;
        return leftRank - rightRank || comparePorts(left, right);
      });
  }

  function defaultOutputPortFor(module: AudioFlowModule): PortDto | null {
    const outputPorts = outputPortsFor(module);
    const maximumDepthByNodeId: Record<number, number> = {};

    for (const path of module.paths) {
      path.nodes.forEach((node, depth) => {
        if (outputPorts.some((port) => port.nodeId === node.id)) {
          maximumDepthByNodeId[node.id] = Math.max(depth, maximumDepthByNodeId[node.id] ?? -1);
        }
      });
    }

    const preferredNodeId = Object.entries(maximumDepthByNodeId)
      .map(([nodeId, depth]) => [Number(nodeId), depth] as const)
      .sort(([leftNodeId, leftDepth], [rightNodeId, rightDepth]) => {
        if (leftDepth !== rightDepth) return rightDepth - leftDepth;
        const leftNode = nodes.find((node) => node.id === leftNodeId);
        const rightNode = nodes.find((node) => node.id === rightNodeId);
        return leftNode && rightNode
          ? stableNodeSort(leftNode, rightNode)
          : leftNodeId - rightNodeId;
      })
      .find(([nodeId]) => {
        const node = nodes.find((candidate) => candidate.id === nodeId);
        return node?.kind !== 'input' || nodeId === module.source.id;
      })?.[0];

    return outputPorts.find((port) => port.nodeId === preferredNodeId) ?? outputPorts[0] ?? null;
  }

  function groupPorts(candidatePorts: PortDto[]): PortGroup[] {
    const candidateNodeIds = candidatePorts.map((port) => port.nodeId);
    return nodes
      .filter((node) => candidateNodeIds.includes(node.id))
      .sort(stableNodeSort)
      .map((node) => ({
        node,
        ports: candidatePorts.filter((port) => port.nodeId === node.id),
      }));
  }

  function endpointLabel(portId: number): string {
    const port = ports.find((candidate) => candidate.id === portId);
    const node = nodes.find((candidate) => candidate.id === port?.nodeId);
    return `${node ? displayName(node) : t('unknown')} · ${port?.name ?? `P${portId}`}`;
  }

  function portMeta(port: PortDto): string {
    return `${t(port.mediaType)} · P${port.id}`;
  }

  function toggleConnectionEditor(module: AudioFlowModule): void {
    if (editingSourceId === module.source.id) {
      closeConnectionEditor();
      return;
    }
    editingSourceId = module.source.id;
    selectedOutputPortId = defaultOutputPortFor(module)?.id ?? null;
    selectedInputPortId = null;
  }

  function closeConnectionEditor(): void {
    chooserMode = null;
    chooserReturnFocus = null;
    editingSourceId = null;
    selectedOutputPortId = null;
    selectedInputPortId = null;
  }

  function openPortChooser(mode: 'output' | 'input', trigger: HTMLElement): void {
    chooserMode = mode;
    chooserReturnFocus = trigger;
  }

  function closePortChooser(): void {
    chooserMode = null;
    const returnFocus = chooserReturnFocus;
    chooserReturnFocus = null;
    requestAnimationFrame(() => returnFocus?.focus());
  }

  function choosePort(port: PortDto): void {
    if (chooserMode === 'output') {
      if (selectedOutputPortId !== port.id) selectedInputPortId = null;
      selectedOutputPortId = port.id;
    } else if (chooserMode === 'input') {
      if (autoStereoMatch) {
        const connections = missingAutomaticConnections(port);
        closePortChooser();
        if (connections.length > 0) onCreateLinks(connections);
        return;
      }
      selectedInputPortId = port.id;
    }
    closePortChooser();
  }

  function missingAutomaticConnections(input: PortDto): NormalizedPorts[] {
    if (!selectedOutput) return [];
    const normalized = normalizePorts(selectedOutput, input);
    if (!normalized) return [];
    return expandStereoConnection(normalized, ports).filter(
      ({ output, input: target }) => !connectionExists(links, pendingLinks, output.id, target.id),
    );
  }

  function createSelectedLink(): void {
    const output = ports.find((port) => port.id === selectedOutputPortId);
    const input = ports.find((port) => port.id === selectedInputPortId);
    if (!output || !input) return;
    const normalized = normalizePorts(output, input);
    if (!normalized) return;
    onCreateLinks([normalized]);
    selectedInputPortId = null;
  }

  function moduleIsFocused(
    module: AudioFlowModule,
    selectedSourceId: number | null,
    linkIds: Set<number>,
  ): boolean {
    if (selectedSourceId !== null) return selectedSourceId === module.source.id;
    return [...module.linkIds].some((linkId) => linkIds.has(linkId));
  }

  function routeIsActive(path: AudioFlowPath): boolean {
    return path.hops.every((hop) => hop.active);
  }

  function connectedRouteCount(module: AudioFlowModule): number {
    return module.paths.filter((path) => path.hops.length > 0).length;
  }

  function stageRole(index: number, count: number): MessageKey {
    if (index === 0) return 'audioSource';
    if (index === count - 1) return 'audioEndpoint';
    return 'audioProcessor';
  }

  function routeLabel(path: AudioFlowPath): string {
    return path.nodes.map(displayName).join(' → ');
  }

  function terminalLinkIds(path: AudioFlowPath): number[] {
    return path.hops.at(-1)?.links.map((link) => link.id) ?? [];
  }

  function routeIsRemoving(path: AudioFlowPath): boolean {
    return terminalLinkIds(path).some((linkId) => removingLinkIds.has(linkId));
  }

  function routeUsageCount(path: AudioFlowPath): number {
    const linkIds = terminalLinkIds(path);
    return Math.max(
      1,
      ...linkIds.map((linkId) => modules.filter((module) => module.linkIds.has(linkId)).length),
    );
  }
</script>

<section
  class="audio-flow-workspace"
  aria-label={t('audioFlows')}
  data-testid="audio-flow-workspace"
>
  <div class="audio-flow-modules">
    {#each modules as module, moduleIndex (module.source.id)}
      {@const moduleFocused =
        editingSourceId === module.source.id ||
        moduleIsFocused(module, selectedFlowSourceId, focusedLinkIds)}
      <article
        class:audio-flow-module--focused={moduleFocused}
        class:audio-flow-module--editing={editingSourceId === module.source.id}
        class:audio-flow-module--deemphasized={focusActive && !moduleFocused}
        class="audio-flow-module"
        data-source-node-id={module.source.id}
        data-testid={`flow-module-${module.source.id}`}
      >
        <header class="audio-flow-module__header">
          <button
            class="audio-flow-module__identity"
            type="button"
            aria-pressed={selectedFlowSourceId === module.source.id}
            aria-label={t('highlightFlow', { name: displayName(module.source) })}
            data-testid={`flow-select-${module.source.id}`}
            onclick={() => onSelectFlow(module.source.id)}
          >
            <span class="audio-flow-module__index">
              {String(moduleIndex + 1).padStart(2, '0')}
            </span>
            <span class="audio-flow-module__name">
              <strong title={displayName(module.source)}>{displayName(module.source)}</strong>
              <small>
                {module.source.mediaName && module.source.name !== module.source.mediaName
                  ? module.source.name
                  : t('audioSource')}
              </small>
            </span>
          </button>

          <div class="audio-flow-module__metrics" aria-label={t('flowMetrics')}>
            <span>{t('routeCount', { count: connectedRouteCount(module) })}</span>
            <span>{t('linkCount', { count: module.linkIds.size })}</span>
            <span
              class:state-active={module.linkIds.size > 0 && module.paths.every(routeIsActive)}
              class:state-inactive={module.linkIds.size === 0 || !module.paths.every(routeIsActive)}
            >
              {module.linkIds.size === 0
                ? t('unrouted')
                : t(module.paths.every(routeIsActive) ? 'active' : 'inactive')}
            </span>
          </div>

          <button
            class="button button--small audio-flow-module__edit"
            type="button"
            aria-expanded={editingSourceId === module.source.id}
            aria-controls={`flow-editor-${module.source.id}`}
            data-testid={`flow-edit-${module.source.id}`}
            onclick={() => toggleConnectionEditor(module)}
          >
            {t(editingSourceId === module.source.id ? 'closeConnectionEditor' : 'editConnections')}
          </button>
        </header>

        {#if editingSourceId === module.source.id}
          <section
            id={`flow-editor-${module.source.id}`}
            class="audio-flow-editor"
            aria-label={t('connectionEditorFor', { name: displayName(module.source) })}
            data-testid={`flow-editor-${module.source.id}`}
          >
            <header class="audio-flow-editor__header">
              <div>
                <h3>{t('connectionEditor')}</h3>
                <p>
                  {t(
                    autoStereoMatch
                      ? 'connectionEditorHintAutomatic'
                      : 'connectionEditorHintManual',
                  )}
                </p>
              </div>
            </header>

            <div
              class:audio-flow-editor__builder--automatic={autoStereoMatch}
              class="audio-flow-editor__builder"
            >
              <div class="audio-flow-editor__field">
                <span>{t(autoStereoMatch ? 'fromStage' : 'fromPort')}</span>
                <button
                  class="audio-flow-editor__port-trigger"
                  type="button"
                  aria-haspopup="dialog"
                  disabled={status.state !== 'connected' || editorOutputPorts.length === 0}
                  data-testid={`flow-output-chooser-trigger-${module.source.id}`}
                  onclick={(event) => openPortChooser('output', event.currentTarget)}
                >
                  <span>
                    <strong>
                      {selectedOutput
                        ? autoStereoMatch && selectedOutputNode
                          ? displayName(selectedOutputNode)
                          : endpointLabel(selectedOutput.id)
                        : t(autoStereoMatch ? 'chooseStage' : 'chooseOutput')}
                    </strong>
                    <small>
                      {selectedOutput
                        ? autoStereoMatch
                          ? t('channelsMatchedAutomatically')
                          : portMeta(selectedOutput)
                        : t('openPortChooser')}
                    </small>
                  </span>
                  <span class="audio-flow-editor__port-action">
                    {t(
                      selectedOutput
                        ? 'changeSelection'
                        : autoStereoMatch
                          ? 'selectStage'
                          : 'selectPort',
                    )}
                  </span>
                </button>
              </div>

              <span class="audio-flow-editor__arrow" aria-hidden="true">→</span>

              <div class="audio-flow-editor__field">
                <span>{t(autoStereoMatch ? 'targetDevice' : 'targetPort')}</span>
                <button
                  class="audio-flow-editor__port-trigger"
                  type="button"
                  aria-haspopup="dialog"
                  disabled={status.state !== 'connected' || availableInputCount === 0}
                  data-testid={`flow-input-chooser-trigger-${module.source.id}`}
                  onclick={(event) => openPortChooser('input', event.currentTarget)}
                >
                  <span>
                    <strong>
                      {selectedInput
                        ? endpointLabel(selectedInput.id)
                        : t(autoStereoMatch ? 'chooseDestination' : 'chooseTarget')}
                    </strong>
                    <small>
                      {selectedInput
                        ? portMeta(selectedInput)
                        : t(autoStereoMatch ? 'connectsImmediately' : 'openPortChooser')}
                    </small>
                  </span>
                  <span class="audio-flow-editor__port-action">
                    {t(
                      selectedInput
                        ? 'changeSelection'
                        : autoStereoMatch
                          ? 'chooseDevice'
                          : 'selectPort',
                    )}
                  </span>
                </button>
              </div>

              {#if !autoStereoMatch}
                <button
                  class="button audio-flow-editor__create"
                  type="button"
                  disabled={status.state !== 'connected' || selectedInputPortId === null}
                  data-testid={`flow-create-link-${module.source.id}`}
                  onclick={createSelectedLink}
                >
                  {t('createConnection')}
                </button>
              {/if}
            </div>

            {#if selectedOutput && availableInputCount === 0}
              <p class="audio-flow-editor__empty-target">{t('noCompatibleTargets')}</p>
            {/if}
          </section>
        {/if}

        <div class="audio-flow-module__routes">
          {#each module.paths as path, routeIndex (path.id)}
            {@const routeRemoving = routeIsRemoving(path)}
            {@const usageCount = routeUsageCount(path)}
            <div
              class:audio-flow-route--inactive={!routeIsActive(path)}
              class="audio-flow-route"
              aria-label={routeLabel(path)}
              data-testid={`flow-route-${module.source.id}-${routeIndex + 1}`}
            >
              <span class="audio-flow-route__index">
                {t('routeNumber', { index: routeIndex + 1 })}
              </span>
              <div class="audio-flow-route__scroll">
                <div class="audio-flow-route__track">
                  {#each path.nodes as node, nodeIndex (`${node.id}-${nodeIndex}`)}
                    {#if nodeIndex > 0}
                      {@const hop = path.hops[nodeIndex - 1]}
                      <div
                        class:audio-flow-hop--inactive={!hop.active}
                        class="audio-flow-hop"
                        title={hop.links.map((link) => `L${link.id}`).join(', ')}
                        data-flow-link-ids={hop.links.map((link) => link.id).join(',')}
                      >
                        <span class="audio-flow-hop__line" aria-hidden="true"></span>
                        <span class="audio-flow-hop__channels">
                          {t('channelCount', { count: hop.links.length })}
                        </span>
                        <span class="audio-flow-hop__arrow" aria-hidden="true">›</span>
                      </div>
                    {/if}

                    <button
                      class:audio-flow-stage--source={nodeIndex === 0}
                      class:audio-flow-stage--endpoint={nodeIndex === path.nodes.length - 1 &&
                        nodeIndex > 0}
                      class="audio-flow-stage"
                      type="button"
                      aria-label={t('highlightFlow', { name: displayName(module.source) })}
                      onclick={() => onSelectFlow(module.source.id)}
                    >
                      <span class="audio-flow-stage__role">
                        {t(stageRole(nodeIndex, path.nodes.length))}
                      </span>
                      <strong title={displayName(node)}>{displayName(node)}</strong>
                      {#if node.mediaName && node.name !== node.mediaName}
                        <small>{node.name}</small>
                      {:else}
                        <small>{t('nodeIdShort', { id: node.id })}</small>
                      {/if}
                    </button>
                  {/each}

                  {#if path.hops.length === 0}
                    <span class="audio-flow-route__unrouted">{t('unroutedHint')}</span>
                  {/if}
                  {#if path.loop}
                    <span class="audio-flow-route__loop">{t('feedbackLoop')}</span>
                  {/if}
                </div>
              </div>
              {#if path.hops.length > 0}
                <div class="audio-flow-route__actions">
                  {#if usageCount > 1}
                    <span>{t('sharedByFlows', { count: usageCount })}</span>
                  {/if}
                  <button
                    class="button button--danger button--small"
                    type="button"
                    disabled={status.state !== 'connected' || routeRemoving}
                    title={t('disconnectRouteTo', {
                      name: displayName(path.nodes.at(-1) ?? module.source),
                    })}
                    data-testid={`flow-route-disconnect-${module.source.id}-${routeIndex + 1}`}
                    onclick={() => onRemoveLinks(terminalLinkIds(path))}
                  >
                    {t(routeRemoving ? 'pending' : 'disconnectRoute')}
                  </button>
                </div>
              {/if}
            </div>
          {/each}

          {#if module.truncated}
            <p class="audio-flow-module__truncated">{t('flowTruncated')}</p>
          {/if}
        </div>
      </article>
    {:else}
      <div class="audio-flow-empty" data-testid="audio-flow-empty">
        <strong>{t('noAudioFlows')}</strong>
        <span>{t('noAudioFlowsHint')}</span>
      </div>
    {/each}
  </div>

  {#if status.state !== 'connected'}
    <div class={`workspace-status workspace-status--${status.state}`} role="status">
      <span class="workspace-status__signal" aria-hidden="true"></span>
      <strong>{t(status.state)}</strong>
      <span>{status.detail ?? t('backendUnavailable')}</span>
    </div>
  {/if}

  {#if chooserMode}
    <PortChooserDialog
      mode={chooserMode}
      groups={chooserMode === 'output'
        ? outputPortGroups
        : autoStereoMatch
          ? automaticInputPortGroups
          : inputPortGroups}
      selectedPortId={chooserMode === 'output' ? selectedOutputPortId : selectedInputPortId}
      automatic={autoStereoMatch}
      {t}
      nodeName={displayName}
      onChoose={choosePort}
      onClose={closePortChooser}
    />
  {/if}
</section>
