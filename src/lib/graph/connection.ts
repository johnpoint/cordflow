import type { LinkDto, MediaType, NodeDto, PortDto } from '../generated/graph';

const stableNameCollator = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
});

export interface NormalizedPorts {
  output: PortDto;
  input: PortDto;
}

export interface PendingLink {
  operationId: string;
  generation: number;
  outputPortId: number;
  inputPortId: number;
  createdAt: number;
}

export interface ConnectedChain {
  nodeIds: Set<number>;
  portIds: Set<number>;
  linkIds: Set<number>;
}

export interface TopologyColumn {
  rank: number;
  nodes: NodeDto[];
}

type StereoSide = 'left' | 'right';

interface StereoPortDescriptor {
  side: StereoSide;
  nameFamily: string | null;
}

export interface StereoPortPair {
  left: PortDto;
  right: PortDto;
}

export interface StereoConnectionBundle<T> {
  connections: T[];
  stereo: boolean;
}

export function connectedChain(
  rootNodeId: number,
  ports: PortDto[],
  links: LinkDto[],
): ConnectedChain {
  const nodeByPort = new Map(ports.map((port) => [port.id, port.nodeId]));
  const adjacency = new Map<number, Array<{ nodeId: number; link: LinkDto }>>();

  for (const link of links) {
    const outputNodeId = nodeByPort.get(link.outputPortId);
    const inputNodeId = nodeByPort.get(link.inputPortId);
    if (outputNodeId === undefined || inputNodeId === undefined) continue;
    const outputEdges = adjacency.get(outputNodeId) ?? [];
    outputEdges.push({ nodeId: inputNodeId, link });
    adjacency.set(outputNodeId, outputEdges);
    if (inputNodeId !== outputNodeId) {
      const inputEdges = adjacency.get(inputNodeId) ?? [];
      inputEdges.push({ nodeId: outputNodeId, link });
      adjacency.set(inputNodeId, inputEdges);
    }
  }

  const nodeIds = new Set([rootNodeId]);
  const portIds = new Set<number>();
  const linkIds = new Set<number>();
  const queue = [rootNodeId];

  for (let index = 0; index < queue.length; index += 1) {
    for (const { nodeId, link } of adjacency.get(queue[index]) ?? []) {
      linkIds.add(link.id);
      portIds.add(link.outputPortId);
      portIds.add(link.inputPortId);
      if (!nodeIds.has(nodeId)) {
        nodeIds.add(nodeId);
        queue.push(nodeId);
      }
    }
  }

  return { nodeIds, portIds, linkIds };
}

export function portsAreCompatible(first: PortDto, second: PortDto): boolean {
  if (first.id === second.id || first.direction === second.direction) return false;
  return (
    first.mediaType === 'unknown' ||
    second.mediaType === 'unknown' ||
    first.mediaType === second.mediaType
  );
}

export function normalizePorts(first: PortDto, second: PortDto): NormalizedPorts | null {
  if (!portsAreCompatible(first, second)) return null;
  return first.direction === 'output'
    ? { output: first, input: second }
    : { output: second, input: first };
}

/**
 * Expands a connection between two stereo nodes into channel-aligned L→L and R→R
 * links. PipeWire's audio.channel metadata is authoritative; common port-name
 * suffixes are supported for clients that do not publish that property.
 */
export function expandStereoConnection(
  connection: NormalizedPorts,
  ports: PortDto[],
): NormalizedPorts[] {
  if (
    connection.output.mediaType === 'midi' ||
    connection.output.mediaType === 'video' ||
    connection.input.mediaType === 'midi' ||
    connection.input.mediaType === 'video'
  ) {
    return [connection];
  }

  const outputPair = findStereoPortPair(connection.output, ports);
  const inputPair = findStereoPortPair(connection.input, ports);
  if (!outputPair || !inputPair) return [connection];

  return [
    { output: outputPair.left, input: inputPair.left },
    { output: outputPair.right, input: inputPair.right },
  ].filter(({ output, input }) => portsAreCompatible(output, input));
}

export function findStereoPortPair(port: PortDto, ports: PortDto[]): StereoPortPair | null {
  const descriptor = describeStereoPort(port);
  if (!descriptor) return null;

  const oppositeSide: StereoSide = descriptor.side === 'left' ? 'right' : 'left';
  const candidates = ports.filter((candidate) => {
    if (
      candidate.id === port.id ||
      candidate.nodeId !== port.nodeId ||
      candidate.direction !== port.direction ||
      candidate.mediaType === 'midi' ||
      candidate.mediaType === 'video'
    ) {
      return false;
    }
    return describeStereoPort(candidate)?.side === oppositeSide;
  });

  const sameFamily = descriptor.nameFamily
    ? candidates.filter(
        (candidate) => describeStereoPort(candidate)?.nameFamily === descriptor.nameFamily,
      )
    : [];
  const counterpart =
    sameFamily.length === 1
      ? sameFamily[0]
      : descriptor.nameFamily === null && candidates.length === 1
        ? candidates[0]
        : null;
  if (!counterpart) return null;

  return descriptor.side === 'left'
    ? { left: port, right: counterpart }
    : { left: counterpart, right: port };
}

export function bundleStereoConnections<T extends Pick<LinkDto, 'outputPortId' | 'inputPortId'>>(
  connections: T[],
  ports: PortDto[],
): StereoConnectionBundle<T>[] {
  const bundled = new Set<T>();
  const result: StereoConnectionBundle<T>[] = [];

  for (const connection of connections) {
    if (bundled.has(connection)) continue;
    const output = ports.find((port) => port.id === connection.outputPortId);
    const input = ports.find((port) => port.id === connection.inputPortId);
    const normalized = output && input ? normalizePorts(output, input) : null;
    const expanded = normalized ? expandStereoConnection(normalized, ports) : [];
    const connectionIsAligned = expanded.some(
      (candidate) =>
        candidate.output.id === connection.outputPortId &&
        candidate.input.id === connection.inputPortId,
    );
    const pair =
      expanded.length === 2 && connectionIsAligned
        ? expanded.map(({ output: pairOutput, input: pairInput }) =>
            connections.find(
              (candidate) =>
                candidate.outputPortId === pairOutput.id && candidate.inputPortId === pairInput.id,
            ),
          )
        : [];

    if (pair.length === 2 && pair[0] && pair[1] && pair[0] !== pair[1]) {
      bundled.add(pair[0]);
      bundled.add(pair[1]);
      result.push({ connections: [pair[0], pair[1]], stereo: true });
    } else {
      bundled.add(connection);
      result.push({ connections: [connection], stereo: false });
    }
  }

  return result;
}

function describeStereoPort(port: PortDto): StereoPortDescriptor | null {
  const nameDescriptor = describeStereoName(port.name);
  const side = channelSide(port.channel) ?? nameDescriptor?.side;
  return side ? { side, nameFamily: nameDescriptor?.nameFamily ?? null } : null;
}

function channelSide(channel: string | null | undefined): StereoSide | null {
  if (!channel) return null;
  const normalized = channel
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_.-]+/g, '');
  if (normalized === 'fl' || normalized === 'frontleft' || normalized === 'left') return 'left';
  if (normalized === 'fr' || normalized === 'frontright' || normalized === 'right') {
    return 'right';
  }
  return null;
}

function describeStereoName(name: string): StereoPortDescriptor | null {
  const normalized = name.trim().toLowerCase();
  const match =
    /(^|[^a-z0-9])(front[\s_.-]*left|front[\s_.-]*right|fl|fr|left|right|l|r)(?=$|[^a-z0-9])/.exec(
      normalized,
    );
  if (!match) return null;

  const token = match[2].replaceAll(/[\s_.-]+/g, '');
  const side: StereoSide =
    token === 'fl' || token === 'frontleft' || token === 'left' || token === 'l' ? 'left' : 'right';
  const tokenStart = match.index + match[1].length;
  const nameFamily =
    `${normalized.slice(0, tokenStart)}#${normalized.slice(tokenStart + match[2].length)}`
      .replaceAll(/[\s_.-]+/g, ':')
      .replaceAll(/^:+|:+$/g, '');
  return { side, nameFamily };
}

export function compatibleTargetIds(
  start: PortDto,
  ports: PortDto[],
  links: LinkDto[] = [],
  pending: PendingLink[] = [],
): Set<number> {
  return new Set(
    ports
      .filter((port) => {
        const normalized = normalizePorts(start, port);
        return (
          normalized !== null &&
          !connectionExists(links, pending, normalized.output.id, normalized.input.id)
        );
      })
      .map((port) => port.id),
  );
}

export function connectionExists(
  links: LinkDto[],
  pending: PendingLink[],
  outputPortId: number,
  inputPortId: number,
): boolean {
  return (
    links.some((link) => link.outputPortId === outputPortId && link.inputPortId === inputPortId) ||
    pending.some((link) => link.outputPortId === outputPortId && link.inputPortId === inputPortId)
  );
}

export function pendingHasExpired(pending: PendingLink, now: number, timeout = 5_000): boolean {
  return now - pending.createdAt >= timeout;
}

export function effectiveMediaType(
  link: Pick<LinkDto, 'mediaType' | 'outputPortId' | 'inputPortId'>,
  ports: PortDto[],
): MediaType {
  if (link.mediaType !== 'unknown') return link.mediaType;
  const output = ports.find((port) => port.id === link.outputPortId)?.mediaType;
  const input = ports.find((port) => port.id === link.inputPortId)?.mediaType;
  return output && output !== 'unknown' ? output : (input ?? 'unknown');
}

export function nodeDisplayName(node: NodeDto, unnamed = 'Unnamed node'): string {
  return node.mediaName?.trim() || node.name.trim() || `${unnamed} #${node.id}`;
}

export function stableNodeSort(left: NodeDto, right: NodeDto): number {
  return (
    stableNameCollator.compare(nodeDisplayName(left), nodeDisplayName(right)) || left.id - right.id
  );
}

function nodeRole(node: NodeDto, nodePorts: PortDto[]): 'source' | 'duplex' | 'destination' {
  if (node.kind === 'output') return 'source';
  if (node.kind === 'input') return 'destination';
  if (node.kind === 'duplex') return 'duplex';

  const directions = new Set(nodePorts.map((port) => port.direction));
  if (directions.has('input') && directions.has('output')) return 'duplex';
  if (directions.has('output')) return 'source';
  if (directions.has('input')) return 'destination';
  return 'duplex';
}

/**
 * Builds as many left-to-right signal-flow columns as the live graph needs.
 * Strongly connected nodes share a column so feedback loops cannot expand forever.
 */
export function layoutTopologyColumns(
  nodes: NodeDto[],
  ports: PortDto[],
  links: LinkDto[],
): TopologyColumn[] {
  if (nodes.length === 0) return [];

  const orderedNodes = [...nodes].sort(stableNodeSort);
  const nodeById = new Map(orderedNodes.map((node) => [node.id, node]));
  const nodeByPort = new Map(ports.map((port) => [port.id, port.nodeId]));
  const portsByNode = new Map<number, PortDto[]>();
  const outgoing = new Map<number, Set<number>>();
  const incoming = new Map<number, Set<number>>();

  for (const node of orderedNodes) {
    portsByNode.set(node.id, []);
    outgoing.set(node.id, new Set());
    incoming.set(node.id, new Set());
  }
  for (const port of ports) {
    portsByNode.get(port.nodeId)?.push(port);
  }
  for (const link of links) {
    const outputNodeId = nodeByPort.get(link.outputPortId);
    const inputNodeId = nodeByPort.get(link.inputPortId);
    if (
      outputNodeId === undefined ||
      inputNodeId === undefined ||
      outputNodeId === inputNodeId ||
      !nodeById.has(outputNodeId) ||
      !nodeById.has(inputNodeId)
    ) {
      continue;
    }
    outgoing.get(outputNodeId)?.add(inputNodeId);
    incoming.get(inputNodeId)?.add(outputNodeId);
  }

  const compareNodeIds = (leftId: number, rightId: number) =>
    stableNodeSort(nodeById.get(leftId)!, nodeById.get(rightId)!);
  const traversalIndex = new Map<number, number>();
  const lowLink = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  const components: number[][] = [];
  let nextIndex = 0;

  const visit = (nodeId: number): void => {
    traversalIndex.set(nodeId, nextIndex);
    lowLink.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of [...(outgoing.get(nodeId) ?? [])].sort(compareNodeIds)) {
      if (!traversalIndex.has(targetId)) {
        visit(targetId);
        lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, lowLink.get(targetId)!));
      } else if (onStack.has(targetId)) {
        lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, traversalIndex.get(targetId)!));
      }
    }

    if (lowLink.get(nodeId) !== traversalIndex.get(nodeId)) return;
    const component: number[] = [];
    let memberId: number;
    do {
      memberId = stack.pop()!;
      onStack.delete(memberId);
      component.push(memberId);
    } while (memberId !== nodeId);
    component.sort(compareNodeIds);
    components.push(component);
  };

  for (const node of orderedNodes) {
    if (!traversalIndex.has(node.id)) visit(node.id);
  }

  const componentByNode = new Map<number, number>();
  components.forEach((component, componentId) => {
    for (const nodeId of component) componentByNode.set(nodeId, componentId);
  });
  const componentOutgoing = components.map(() => new Set<number>());
  const componentIncoming = components.map(() => new Set<number>());
  for (const [nodeId, targets] of outgoing) {
    const fromComponent = componentByNode.get(nodeId)!;
    for (const targetId of targets) {
      const toComponent = componentByNode.get(targetId)!;
      if (fromComponent === toComponent) continue;
      componentOutgoing[fromComponent].add(toComponent);
      componentIncoming[toComponent].add(fromComponent);
    }
  }

  const compareComponents = (leftId: number, rightId: number) =>
    compareNodeIds(components[leftId][0], components[rightId][0]);
  const indegrees = componentIncoming.map((predecessors) => predecessors.size);
  const componentRanks = components.map(() => 0);
  const ready = components
    .map((_, componentId) => componentId)
    .filter((componentId) => indegrees[componentId] === 0)
    .sort(compareComponents);

  while (ready.length > 0) {
    const componentId = ready.shift()!;
    for (const targetId of [...componentOutgoing[componentId]].sort(compareComponents)) {
      componentRanks[targetId] = Math.max(
        componentRanks[targetId],
        componentRanks[componentId] + 1,
      );
      indegrees[targetId] -= 1;
      if (indegrees[targetId] === 0) {
        ready.push(targetId);
        ready.sort(compareComponents);
      }
    }
  }

  const lastRank = Math.max(2, ...componentRanks);
  components.forEach((component, componentId) => {
    const isIsolated =
      componentIncoming[componentId].size === 0 && componentOutgoing[componentId].size === 0;
    if (isIsolated && component.length === 1) {
      const node = nodeById.get(component[0])!;
      const role = nodeRole(node, portsByNode.get(node.id) ?? []);
      componentRanks[componentId] =
        role === 'source' ? 0 : role === 'destination' ? lastRank : Math.ceil(lastRank / 2);
      return;
    }

    const isTerminalDestination =
      componentOutgoing[componentId].size === 0 &&
      component.some((nodeId) => {
        const node = nodeById.get(nodeId)!;
        return nodeRole(node, portsByNode.get(node.id) ?? []) === 'destination';
      });
    if (isTerminalDestination) componentRanks[componentId] = lastRank;
  });

  const nodesByRank = new Map<number, NodeDto[]>();
  components.forEach((component, componentId) => {
    const column = nodesByRank.get(componentRanks[componentId]) ?? [];
    column.push(...component.map((nodeId) => nodeById.get(nodeId)!));
    nodesByRank.set(componentRanks[componentId], column);
  });

  const columns = [...nodesByRank]
    .sort(([leftRank], [rightRank]) => leftRank - rightRank)
    .map(([rank, columnNodes]) => ({ rank, nodes: columnNodes.sort(stableNodeSort) }));

  const columnByNode = new Map<number, number>();
  columns.forEach((column, columnIndex) => {
    for (const node of column.nodes) columnByNode.set(node.id, columnIndex);
  });
  const neighbors = new Map<number, Set<number>>();
  for (const node of orderedNodes) {
    neighbors.set(
      node.id,
      new Set([...(incoming.get(node.id) ?? []), ...(outgoing.get(node.id) ?? [])]),
    );
  }

  const sortColumnByBarycenter = (columnIndex: number): void => {
    const positions = new Map<number, number>();
    for (const column of columns) {
      const divisor = Math.max(1, column.nodes.length - 1);
      column.nodes.forEach((node, index) => positions.set(node.id, index / divisor));
    }
    const score = (nodeId: number): number | null => {
      const adjacentRows = [...(neighbors.get(nodeId) ?? [])]
        .filter((neighborId) => columnByNode.get(neighborId) !== columnIndex)
        .map((neighborId) => positions.get(neighborId))
        .filter((position): position is number => position !== undefined);
      if (adjacentRows.length === 0) return null;
      return adjacentRows.reduce((sum, position) => sum + position, 0) / adjacentRows.length;
    };

    columns[columnIndex].nodes.sort((left, right) => {
      const leftScore = score(left.id);
      const rightScore = score(right.id);
      if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      if (leftScore !== null && rightScore === null) return -1;
      if (leftScore === null && rightScore !== null) return 1;
      const leftConnected = (neighbors.get(left.id)?.size ?? 0) > 0;
      const rightConnected = (neighbors.get(right.id)?.size ?? 0) > 0;
      if (leftConnected !== rightConnected) return leftConnected ? -1 : 1;
      return stableNodeSort(left, right);
    });
  };

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    sortColumnByBarycenter(columnIndex);
  }
  for (let columnIndex = columns.length - 1; columnIndex >= 0; columnIndex -= 1) {
    sortColumnByBarycenter(columnIndex);
  }
  return columns;
}

export function classifyNodes(nodes: NodeDto[], ports: PortDto[]) {
  const result = {
    sources: [] as NodeDto[],
    duplex: [] as NodeDto[],
    destinations: [] as NodeDto[],
  };
  for (const node of nodes) {
    if (node.kind === 'output') {
      result.sources.push(node);
      continue;
    }
    if (node.kind === 'input') {
      result.destinations.push(node);
      continue;
    }
    if (node.kind === 'duplex') {
      result.duplex.push(node);
      continue;
    }

    const role = nodeRole(
      node,
      ports.filter((port) => port.nodeId === node.id),
    );
    if (role === 'source') result.sources.push(node);
    else if (role === 'destination') result.destinations.push(node);
    else result.duplex.push(node);
  }
  result.sources.sort(stableNodeSort);
  result.duplex.sort(stableNodeSort);
  result.destinations.sort(stableNodeSort);
  return result;
}
