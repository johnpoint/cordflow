<script lang="ts">
  import { onMount } from 'svelte';
  import type { GraphStatus, LinkDto, NodeDto, PortDto } from '../generated/graph';
  import type { MessageKey } from '../i18n';
  import {
    compatibleTargetIds as findCompatibleTargets,
    expandStereoConnection,
    layoutTopologyColumns,
    normalizePorts,
    type NormalizedPorts,
    type PendingLink,
    type TopologyColumn,
  } from '../graph/connection';
  import { computePortAnchor, type Point } from '../graph/layout';
  import LinkLayer from './LinkLayer.svelte';
  import NodeCard from './NodeCard.svelte';

  export let nodes: NodeDto[];
  export let ports: PortDto[];
  export let links: LinkDto[];
  export let pendingLinks: PendingLink[];
  export let status: GraphStatus;
  export let selectedLinkId: number | null;
  export let selectedNodeId: number | null;
  export let focusedLinkIds: Set<number>;
  export let focusedPortIds: Set<number>;
  export let focusedNodeIds: Set<number>;
  export let focusActive: boolean;
  export let autoStereoMatch: boolean;
  export let hideInactiveNodes: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onCreateLinks: (ports: NormalizedPorts[]) => void;
  export let onSelectLink: (linkId: number | null) => void;
  export let onSelectNode: (nodeId: number) => void;
  export let onClearSelection: () => void;
  export let onAnnounce: (message: string) => void;
  export let onHideInactiveNodesChange: (event: Event) => void;

  let canvas: HTMLDivElement;
  let graphColumns: HTMLDivElement;
  let anchors: Record<number, Point> = {};
  let canvasHeight = 640;
  let selectedStartPortId: number | null = null;
  let dragging = false;
  let previewPoint: Point | null = null;
  let measureFrame = 0;

  $: topologyColumns = layoutTopologyColumns(nodes, ports, links);
  $: renderedColumns =
    topologyColumns.length > 0 ? topologyColumns : ([{ rank: 0, nodes: [] }] as TopologyColumn[]);
  $: portsByNode = indexPortsByNode(ports);
  $: canvasMinWidth = Math.max(
    1020,
    renderedColumns.length * 280 + Math.max(0, renderedColumns.length - 1) * 10 + 20,
  );
  $: selectedStartPort = ports.find((port) => port.id === selectedStartPortId) ?? null;
  $: selectedStartNode = nodes.find((node) => node.id === selectedStartPort?.nodeId) ?? null;
  $: selectedStartLabel = selectedStartPort
    ? `${selectedStartNode?.mediaName ?? selectedStartNode?.name ?? t('unknown')} · ${selectedStartPort.name}`
    : null;
  $: compatibleTargetIds = selectedStartPort
    ? findCompatibleTargets(selectedStartPort, ports, links, pendingLinks)
    : new Set<number>();
  $: connectedPortIds = new Set(links.flatMap((link) => [link.outputPortId, link.inputPortId]));
  $: preview =
    dragging && selectedStartPort && previewPoint && anchors[selectedStartPort.id]
      ? {
          from: anchors[selectedStartPort.id],
          to: previewPoint,
          mediaType: selectedStartPort.mediaType,
          valid: true,
        }
      : null;
  $: if (status.state !== 'connected' && (selectedStartPortId !== null || dragging)) {
    cancelSelection();
  }
  $: if (selectedStartPortId !== null && !ports.some((port) => port.id === selectedStartPortId)) {
    selectedStartPortId = null;
  }

  function indexPortsByNode(allPorts: PortDto[]): Record<number, PortDto[]> {
    const result: Record<number, PortDto[]> = {};
    for (const port of allPorts) {
      const nodePorts = result[port.nodeId] ?? [];
      nodePorts.push(port);
      result[port.nodeId] = nodePorts;
    }
    return result;
  }

  function scheduleMeasure(): void {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(measureAnchors);
  }

  function measureAnchors(): void {
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const next: Record<number, Point> = {};
    for (const element of canvas.querySelectorAll<HTMLElement>('[data-port-id]')) {
      const id = Number(element.dataset.portId);
      const direction = element.dataset.direction === 'output' ? 'output' : 'input';
      next[id] = computePortAnchor(element.getBoundingClientRect(), canvasRect, direction);
    }
    anchors = next;
    canvasHeight = Math.max(640, graphColumns.offsetTop + graphColumns.offsetHeight + 18);
  }

  function pointerPoint(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPortPointerDown(event: PointerEvent, port: PortDto): void {
    if (event.button !== 0 || status.state !== 'connected') return;
    event.preventDefault();

    const start = ports.find((candidate) => candidate.id === selectedStartPortId);
    if (start && start.id !== port.id && compatibleTargetIds.has(port.id)) {
      tryConnection(start, port);
      return;
    }

    selectedStartPortId = port.id;
    dragging = true;
    previewPoint = pointerPoint(event);
    onClearSelection();
  }

  function onWindowPointerMove(event: PointerEvent): void {
    if (dragging) previewPoint = pointerPoint(event);
  }

  function onWindowPointerUp(event: PointerEvent): void {
    if (!dragging) return;
    const start = ports.find((port) => port.id === selectedStartPortId);
    const targetElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-port-id]');
    const target = ports.find((port) => port.id === Number(targetElement?.dataset.portId));
    dragging = false;
    previewPoint = null;
    if (start && target && start.id !== target.id) {
      tryConnection(start, target);
    } else if (start && target?.id === start.id) {
      onAnnounce(t('keyboardStart'));
    }
  }

  function onPortKeyDown(event: KeyboardEvent, port: PortDto): void {
    if (event.key === 'Tab' && selectedStartPort) {
      const targets = Array.from(
        canvas.querySelectorAll<HTMLButtonElement>('[data-port-id]'),
      ).filter((button) => compatibleTargetIds.has(Number(button.dataset.portId)));
      if (targets.length > 0) {
        event.preventDefault();
        const currentIndex = targets.findIndex(
          (button) => Number(button.dataset.portId) === port.id,
        );
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? targets.length - 1
            : currentIndex - 1
          : currentIndex < 0 || currentIndex === targets.length - 1
            ? 0
            : currentIndex + 1;
        targets[nextIndex].focus();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelSelection();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (status.state !== 'connected') return;

    const start = ports.find((candidate) => candidate.id === selectedStartPortId);
    if (!start) {
      selectedStartPortId = port.id;
      onClearSelection();
      onAnnounce(t('keyboardStart'));
    } else if (start.id === port.id) {
      cancelSelection();
    } else {
      tryConnection(start, port);
    }
  }

  function tryConnection(first: PortDto, second: PortDto): void {
    const normalized = normalizePorts(first, second);
    if (!normalized) return;
    onCreateLinks(autoStereoMatch ? expandStereoConnection(normalized, ports) : [normalized]);
    selectedStartPortId = null;
  }

  function cancelSelection(): void {
    if (selectedStartPortId === null && !dragging) return;
    selectedStartPortId = null;
    dragging = false;
    previewPoint = null;
    onAnnounce(t('keyboardCancel'));
  }

  function onCanvasPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-port-id], [data-node-id], [data-link-id]')) {
      cancelSelection();
      onClearSelection();
    }
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      cancelSelection();
      onClearSelection();
    }
  }

  onMount(() => {
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(canvas);
    observer.observe(graphColumns);
    const mutations = new MutationObserver(scheduleMeasure);
    mutations.observe(graphColumns, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('keydown', onWindowKeyDown);
    scheduleMeasure();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(measureFrame);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  });
</script>

<section class="workspace-scroll" aria-label={t('graph')} data-testid="workspace">
  <div
    class="patchbay-interaction-strip"
    data-testid="patchbay-interaction-strip"
    aria-live="polite"
  >
    <div class="patchbay-interaction-strip__status">
      <strong>
        {selectedStartLabel
          ? t('patchbaySelectedStart', { port: selectedStartLabel })
          : t('patchbayStartHint')}
      </strong>
      <span>
        {selectedStartPort
          ? t('compatibleTargetsCount', { count: compatibleTargetIds.size })
          : t('patchbayPointerHint')}
      </span>
    </div>
    <div class="patchbay-interaction-strip__controls">
      <label class="patchbay-filter-switch" data-testid="hide-inactive-nodes-control">
        <span>{t('hideInactiveNodes')}</span>
        <input
          class="patchbay-filter-switch__input"
          type="checkbox"
          role="switch"
          checked={hideInactiveNodes}
          aria-label={t('hideInactiveNodes')}
          data-testid="hide-inactive-nodes-toggle"
          onchange={onHideInactiveNodesChange}
        />
        <span class="patchbay-filter-switch__track" aria-hidden="true"><i></i></span>
      </label>
      <div class="patchbay-interaction-strip__shortcuts">
        <span><kbd>Tab</kbd>{t('moveTargets')}</span>
        <span><kbd>Enter</kbd>{t('connectTarget')}</span>
        <span><kbd>Esc</kbd>{t('cancelSelection')}</span>
      </div>
    </div>
  </div>
  <div
    class="workspace-canvas"
    bind:this={canvas}
    style={`--canvas-height: ${canvasHeight}px; --canvas-width: ${canvasMinWidth}px; --topology-column-count: ${renderedColumns.length}`}
    role="group"
    aria-label={t('portTopology')}
    onpointerdown={onCanvasPointerDown}
  >
    <LinkLayer
      {anchors}
      {links}
      {pendingLinks}
      {ports}
      {nodes}
      {selectedLinkId}
      {focusedLinkIds}
      {focusActive}
      {preview}
      {t}
      {onSelectLink}
    />

    <div class="graph-columns" bind:this={graphColumns}>
      {#each renderedColumns as column, stageIndex (column.rank)}
        <section
          class:graph-column--first={stageIndex === 0}
          class:graph-column--last={stageIndex === renderedColumns.length - 1}
          class:graph-column--single={renderedColumns.length === 1}
          class="graph-column"
          data-topology-rank={column.rank}
          data-testid={`topology-column-${stageIndex + 1}`}
        >
          <header class="graph-column__header">
            <span class="graph-column__index">{String(stageIndex + 1).padStart(2, '0')}</span>
            <div>
              <h2>{t('signalStage', { index: stageIndex + 1 })}</h2>
            </div>
            <span class="graph-column__count">{column.nodes.length}</span>
          </header>
          <div class="graph-column__nodes">
            {#each column.nodes as node (node.id)}
              <NodeCard
                {node}
                ports={portsByNode[node.id] ?? []}
                {selectedStartPortId}
                {compatibleTargetIds}
                {connectedPortIds}
                {focusedPortIds}
                focused={focusedNodeIds.has(node.id)}
                focusRoot={selectedNodeId === node.id}
                deemphasized={focusActive && !focusedNodeIds.has(node.id)}
                interactive={status.state === 'connected'}
                {t}
                {onPortPointerDown}
                {onPortKeyDown}
                {onSelectNode}
              />
            {:else}
              <p class="column-empty">{t(hideInactiveNodes ? 'noActiveNodes' : 'emptyGraph')}</p>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    {#if status.state !== 'connected'}
      <div class={`workspace-status workspace-status--${status.state}`} role="status">
        <span class="workspace-status__signal" aria-hidden="true"></span>
        <strong>{t(status.state)}</strong>
        <span>{status.detail ?? t('backendUnavailable')}</span>
      </div>
    {/if}
  </div>
</section>
