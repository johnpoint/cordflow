<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, Check, ChevronRight, Search, SkipForward, X } from '@lucide/svelte';
  import type { GraphStatus, LinkDto, NodeDto, PortDto } from '../generated/graph';
  import {
    connectionExists,
    expandStereoConnection,
    nodeDisplayName,
    normalizePorts,
    stableNodeSort,
    type NormalizedPorts,
    type PendingLink,
  } from '../graph/connection';
  import type { MessageKey } from '../i18n';

  interface HopPlan {
    fromNodeId: number;
    toNodeId: number;
    connections: NormalizedPorts[];
    missingConnections: NormalizedPorts[];
    score: number;
  }

  type BuilderStep = 1 | 2 | 3;

  export let nodes: NodeDto[];
  export let ports: PortDto[];
  export let links: LinkDto[];
  export let pendingLinks: PendingLink[];
  export let status: GraphStatus;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onComplete: (connections: NormalizedPorts[]) => void;
  export let onClose: () => void;

  let step: BuilderStep = 1;
  let sourceNodeId: number | null = null;
  let processorNodeIds: number[] = [];
  let destinationNodeIds: number[] = [];
  let query = '';
  let dialogElement: HTMLElement;
  let searchInput: HTMLInputElement;

  $: sourceNodes = getSourceNodes(nodes, ports);
  $: sourceNode = sourceNodeId === null ? null : nodeById(sourceNodeId);
  $: chainNodeIds = sourceNodeId === null ? [] : [sourceNodeId, ...processorNodeIds];
  $: currentNodeId = chainNodeIds.at(-1) ?? null;
  $: processorNodes = currentNodeId === null ? [] : getProcessorNodes(currentNodeId);
  $: destinationNodes = currentNodeId === null ? [] : getDestinationNodes(currentNodeId);
  $: normalizedQuery = query.trim().toLocaleLowerCase();
  $: visibleNodes = (
    step === 1 ? sourceNodes : step === 2 ? processorNodes : destinationNodes
  ).filter(matchesQuery);
  $: chainPlans = chainNodeIds
    .slice(1)
    .map((nodeId, index) => planHop(chainNodeIds[index], nodeId));
  $: destinationPlans =
    currentNodeId === null
      ? []
      : destinationNodeIds.map((nodeId) => planHop(currentNodeId!, nodeId));
  $: allPlans = [...chainPlans, ...destinationPlans];
  $: expectedPlanCount = processorNodeIds.length + destinationNodeIds.length;
  $: plansAreComplete =
    allPlans.length === expectedPlanCount && allPlans.every((plan) => plan !== null);
  $: missingConnections = deduplicateConnections(
    allPlans.flatMap((plan) => plan?.missingConnections ?? []),
  );
  $: reusedConnections =
    allPlans.flatMap((plan) => plan?.connections ?? []).length - missingConnections.length;
  $: canComplete =
    status.state === 'connected' &&
    step === 3 &&
    destinationNodeIds.length > 0 &&
    plansAreComplete &&
    missingConnections.length > 0;

  function displayName(node: NodeDto): string {
    return nodeDisplayName(node, t('unnamedNode'));
  }

  function audioPorts(nodeId: number, direction: 'input' | 'output'): PortDto[] {
    return ports
      .filter(
        (port) =>
          port.nodeId === nodeId &&
          port.direction === direction &&
          (port.mediaType === 'audio' || port.mediaType === 'unknown'),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, 'en', { numeric: true }) || left.id - right.id,
      );
  }

  function getSourceNodes(candidateNodes: NodeDto[], candidatePorts: PortDto[]): NodeDto[] {
    const portsFor = (nodeId: number, direction: 'input' | 'output') =>
      candidatePorts.filter(
        (port) =>
          port.nodeId === nodeId &&
          port.direction === direction &&
          (port.mediaType === 'audio' || port.mediaType === 'unknown'),
      );
    const withAudioOutput = candidateNodes.filter((node) => portsFor(node.id, 'output').length > 0);
    const naturalSources = withAudioOutput.filter(
      (node) => node.kind === 'output' || portsFor(node.id, 'input').length === 0,
    );
    return (naturalSources.length > 0 ? naturalSources : withAudioOutput).sort(stableNodeSort);
  }

  function isOutputDevice(node: NodeDto): boolean {
    return node.kind === 'input' || audioPorts(node.id, 'output').length === 0;
  }

  function getProcessorNodes(fromNodeId: number): NodeDto[] {
    return nodes
      .filter(
        (node) =>
          node.id !== fromNodeId &&
          node.id !== sourceNodeId &&
          !processorNodeIds.includes(node.id) &&
          !isOutputDevice(node) &&
          audioPorts(node.id, 'input').length > 0 &&
          audioPorts(node.id, 'output').length > 0 &&
          planHop(fromNodeId, node.id) !== null,
      )
      .sort(stableNodeSort);
  }

  function getDestinationNodes(fromNodeId: number): NodeDto[] {
    return nodes
      .filter(
        (node) =>
          node.id !== fromNodeId &&
          !chainNodeIds.includes(node.id) &&
          isOutputDevice(node) &&
          audioPorts(node.id, 'input').length > 0 &&
          planHop(fromNodeId, node.id) !== null,
      )
      .sort(stableNodeSort);
  }

  function planHop(fromNodeId: number, toNodeId: number): HopPlan | null {
    let best: HopPlan | null = null;
    const outputs = audioPorts(fromNodeId, 'output');
    const inputs = audioPorts(toNodeId, 'input');

    outputs.forEach((output, outputIndex) => {
      inputs.forEach((input, inputIndex) => {
        const normalized = normalizePorts(output, input);
        if (!normalized) return;
        const connections = expandStereoConnection(normalized, ports);
        if (connections.length === 0) return;
        const missing = connections.filter(
          ({ output: candidateOutput, input: candidateInput }) =>
            !connectionExists(links, pendingLinks, candidateOutput.id, candidateInput.id),
        );
        const reusedCount = connections.length - missing.length;
        const score =
          (connections.length === 2 ? 10_000 : 0) +
          reusedCount * 1_000 -
          outputIndex * 10 -
          inputIndex;
        if (!best || score > best.score) {
          best = {
            fromNodeId,
            toNodeId,
            connections,
            missingConnections: missing,
            score,
          };
        }
      });
    });

    return best;
  }

  function matchesQuery(node: NodeDto): boolean {
    if (!normalizedQuery) return true;
    return [displayName(node), node.name, `Node ${node.id}`, String(node.id)].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  }

  function chooseSource(node: NodeDto): void {
    sourceNodeId = node.id;
    processorNodeIds = [];
    destinationNodeIds = [];
    changeStep(2);
  }

  function addProcessor(node: NodeDto): void {
    processorNodeIds = [...processorNodeIds, node.id];
    destinationNodeIds = [];
    query = '';
    requestAnimationFrame(() => searchInput?.focus());
  }

  function toggleDestination(nodeId: number): void {
    destinationNodeIds = destinationNodeIds.includes(nodeId)
      ? destinationNodeIds.filter((candidate) => candidate !== nodeId)
      : [...destinationNodeIds, nodeId];
  }

  function removeProcessor(nodeId: number): void {
    const index = processorNodeIds.indexOf(nodeId);
    if (index < 0) return;
    processorNodeIds = processorNodeIds.slice(0, index);
    destinationNodeIds = [];
  }

  function changeStep(nextStep: BuilderStep): void {
    if (nextStep > 1 && sourceNodeId === null) return;
    step = nextStep;
    query = '';
    requestAnimationFrame(() => searchInput?.focus());
  }

  function resetBuilder(): void {
    step = 1;
    sourceNodeId = null;
    processorNodeIds = [];
    destinationNodeIds = [];
    query = '';
  }

  function completeFlow(): void {
    if (!canComplete) return;
    onComplete(missingConnections);
    onClose();
  }

  function deduplicateConnections(connections: NormalizedPorts[]): NormalizedPorts[] {
    return connections.filter(
      (connection, index) =>
        connections.findIndex(
          (candidate) =>
            candidate.output.id === connection.output.id &&
            candidate.input.id === connection.input.id,
        ) === index,
    );
  }

  function nodeById(nodeId: number): NodeDto | null {
    return nodes.find((node) => node.id === nodeId) ?? null;
  }

  function handleWindowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [
      ...dialogElement.querySelectorAll<HTMLElement>('button, input, select'),
    ].filter((element) => !element.hasAttribute('disabled'));
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

  onMount(() => searchInput.focus());
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div class="port-chooser-backdrop" data-testid="flow-builder">
  <button
    class="port-chooser-backdrop__dismiss"
    type="button"
    tabindex="-1"
    aria-label={t('closeFlowBuilder')}
    onclick={onClose}
  ></button>

  <div
    class="port-chooser-dialog flow-builder-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="flow-builder-title"
    aria-describedby="flow-builder-hint"
    bind:this={dialogElement}
  >
    <header class="port-chooser-dialog__header">
      <div>
        <span>{t('guidedSetup')}</span>
        <h2 id="flow-builder-title">{t('createAudioFlow')}</h2>
        <p id="flow-builder-hint">{t('audioFlowBuilderHint')}</p>
      </div>
      <button
        class="port-chooser-dialog__close"
        type="button"
        aria-label={t('closeFlowBuilder')}
        data-testid="flow-builder-close"
        onclick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>

    <div class="flow-builder-progress" aria-label={t('flowBuilderProgress')}>
      {#each [t('chooseAudioSource'), t('addProcessingSteps'), t('chooseOutputDevices')] as label, index (index)}
        <button
          class:flow-builder-progress__step--active={step === index + 1}
          class:flow-builder-progress__step--complete={step > index + 1}
          type="button"
          disabled={index > 0 && sourceNodeId === null}
          aria-current={step === index + 1 ? 'step' : undefined}
          onclick={() => changeStep((index + 1) as BuilderStep)}
        >
          <b>{step > index + 1 ? '✓' : index + 1}</b>
          <span>{label}</span>
        </button>
        {#if index < 2}<ChevronRight size={16} aria-hidden="true" />{/if}
      {/each}
    </div>

    <label class="port-chooser-dialog__search">
      <span
        ><Search size={15} aria-hidden="true" />{t(
          step === 1 ? 'searchSources' : 'searchSteps',
        )}</span
      >
      <input
        type="search"
        bind:this={searchInput}
        bind:value={query}
        placeholder={t(step === 1 ? 'searchSourcesPlaceholder' : 'searchStepsPlaceholder')}
        autocomplete="off"
        data-testid="flow-builder-search"
      />
    </label>

    <div class="port-chooser-dialog__body flow-builder-body">
      {#if sourceNodeId !== null}
        <section class="flow-builder-plan" aria-label={t('selectedFlowPlan')}>
          <header>
            <strong>{t('selectedFlowPlan')}</strong>
            <span
              >{t('flowBuilderConnectionSummary', {
                new: missingConnections.length,
                reused: reusedConnections,
              })}</span
            >
          </header>
          <div class="flow-builder-chain">
            {#if sourceNode}
              <span class="flow-builder-chip">
                <small>{t('sourceStep')}</small><strong>{displayName(sourceNode)}</strong>
              </span>
            {/if}
            {#each processorNodeIds as nodeId (nodeId)}
              {@const processor = nodeById(nodeId)}
              {#if processor}
                <i aria-hidden="true">→</i>
                <button
                  class="flow-builder-chip"
                  type="button"
                  onclick={() => removeProcessor(nodeId)}
                >
                  <small>{t('processingStep')}</small><strong>{displayName(processor)}</strong>
                  <span>{t('removeStep')}</span>
                </button>
              {/if}
            {/each}
          </div>
          {#if destinationNodeIds.length > 0}
            <div class="flow-builder-destinations">
              <span aria-hidden="true">↳</span>
              <div>
                {#each destinationNodeIds as nodeId (nodeId)}
                  {@const destination = nodeById(nodeId)}
                  {#if destination}
                    <span class="flow-builder-destination-chip">
                      <strong>{displayName(destination)}</strong><small
                        >{t('outputDeviceStep')}</small
                      >
                    </span>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        </section>
      {/if}

      <section class="flow-builder-options">
        <header>
          <div>
            <h3>
              {t(
                step === 1
                  ? 'chooseAudioSource'
                  : step === 2
                    ? 'addProcessingSteps'
                    : 'chooseOutputDevices',
              )}
            </h3>
            <p>
              {t(
                step === 1
                  ? 'chooseAudioSourceHint'
                  : step === 2
                    ? 'processingStepsHint'
                    : 'chooseOutputDevicesHint',
              )}
            </p>
          </div>
          {#if step === 3}
            <span>{t('selectedOutputsCount', { count: destinationNodeIds.length })}</span>
          {/if}
        </header>

        <div class="flow-builder-option-list">
          {#each visibleNodes as node (node.id)}
            {@const selected = destinationNodeIds.includes(node.id)}
            {@const fromNodeId = currentNodeId}
            {@const candidatePlan = fromNodeId === null ? null : planHop(fromNodeId, node.id)}
            <button
              class:flow-builder-option--destination={step === 3}
              class:flow-builder-option--selected={selected}
              class="flow-builder-option"
              type="button"
              aria-pressed={step === 3 ? selected : undefined}
              data-testid={step === 1
                ? `flow-builder-source-${node.id}`
                : step === 2
                  ? `flow-builder-step-${node.id}`
                  : `flow-builder-destination-${node.id}`}
              onclick={() =>
                step === 1
                  ? chooseSource(node)
                  : step === 2
                    ? addProcessor(node)
                    : toggleDestination(node.id)}
            >
              <span class="flow-builder-option__index">
                {step === 1
                  ? t('sourceStep')
                  : step === 2
                    ? t('processingStep')
                    : t('outputDeviceStep')}
              </span>
              <span>
                <strong>{displayName(node)}</strong>
                <small>
                  {candidatePlan?.missingConnections.length === 0 && fromNodeId !== null
                    ? t('existingConnectionReused')
                    : t('nodeIdShort', { id: node.id })}
                </small>
              </span>
              <b
                >{step === 3
                  ? selected
                    ? t('selectedPort')
                    : t('addOutputDevice')
                  : t('selectStep')}</b
              >
              {#if selected}<Check size={16} aria-hidden="true" />{/if}
            </button>
          {:else}
            <div class="port-chooser-dialog__empty" role="status">
              <strong
                >{t(
                  step === 1 ? 'noAudioSources' : step === 2 ? 'noProcessors' : 'noOutputDevices',
                )}</strong
              >
              <span
                >{t(
                  step === 1
                    ? 'noAudioSourcesHint'
                    : step === 2
                      ? 'noProcessorsHint'
                      : 'noNextStepsHint',
                )}</span
              >
            </div>
          {/each}
        </div>
      </section>
    </div>

    <footer class="flow-builder-footer">
      <div>
        {#if step > 1}
          <button
            class="button button--ghost"
            type="button"
            onclick={() => changeStep((step - 1) as BuilderStep)}
          >
            <ArrowLeft size={16} aria-hidden="true" />{t('previousStep')}
          </button>
        {/if}
        <button class="button button--ghost" type="button" onclick={resetBuilder}
          >{t('startOver')}</button
        >
      </div>
      <div>
        <span>
          {step < 3
            ? t(step === 2 ? 'processingOptional' : 'chooseSourceToContinue')
            : destinationNodeIds.length === 0
              ? t('selectOutputToFinish')
              : missingConnections.length === 0
                ? t('flowAlreadyExists')
                : t('flowReadyToCreate', { count: missingConnections.length })}
        </span>
        {#if step === 2}
          <button
            class="button flow-builder-complete"
            type="button"
            data-testid="flow-builder-skip-processing"
            onclick={() => changeStep(3)}
          >
            <SkipForward size={16} aria-hidden="true" />
            {t(processorNodeIds.length === 0 ? 'skipProcessing' : 'continueToOutputs')}
          </button>
        {:else if step === 3}
          <button
            class="button flow-builder-complete"
            type="button"
            disabled={!canComplete}
            data-testid="flow-builder-complete"
            onclick={completeFlow}
          >
            {t('finishAudioFlow')}
          </button>
        {/if}
      </div>
    </footer>
  </div>
</div>
