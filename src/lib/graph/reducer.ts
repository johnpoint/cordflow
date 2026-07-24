import type {
  GraphDelta,
  GraphEnvelope,
  GraphStatus,
  LinkDto,
  NodeDto,
  OperationFailure,
  PortDto,
} from '../generated/graph';

export interface GraphViewState {
  generation: number;
  sequence: number;
  nodes: NodeDto[];
  ports: PortDto[];
  links: LinkDto[];
  defaultAudioSinkName: string | null;
  defaultAudioSourceName: string | null;
  status: GraphStatus;
}

export interface ReduceResult {
  state: GraphViewState;
  applied: boolean;
  needsResync: boolean;
  operationFailure?: OperationFailure;
}

export function emptyGraphState(): GraphViewState {
  return {
    generation: -1,
    sequence: -1,
    nodes: [],
    ports: [],
    links: [],
    defaultAudioSinkName: null,
    defaultAudioSourceName: null,
    status: { state: 'connecting', detail: null },
  };
}

export function reduceEnvelope(state: GraphViewState, envelope: GraphEnvelope): ReduceResult {
  if (envelope.generation < state.generation) return unchanged(state);

  if (envelope.payload.type === 'snapshot') {
    if (envelope.generation === state.generation && envelope.sequence < state.sequence) {
      return unchanged(state);
    }
    return {
      state: {
        generation: envelope.generation,
        sequence: envelope.sequence,
        nodes: [...envelope.payload.data.nodes],
        ports: [...envelope.payload.data.ports],
        links: [...envelope.payload.data.links],
        defaultAudioSinkName: envelope.payload.data.defaultAudioSinkName,
        defaultAudioSourceName: envelope.payload.data.defaultAudioSourceName,
        status: envelope.payload.data.status,
      },
      applied: true,
      needsResync: false,
    };
  }

  if (envelope.generation > state.generation) {
    return { ...unchanged(state), needsResync: true };
  }
  if (envelope.sequence <= state.sequence) return unchanged(state);
  if (envelope.sequence !== state.sequence + 1) {
    return { ...unchanged(state), needsResync: true };
  }

  const next = { ...state, sequence: envelope.sequence };
  switch (envelope.payload.type) {
    case 'delta':
      applyDelta(next, envelope.payload.data);
      break;
    case 'status':
      next.status = envelope.payload.data;
      break;
    case 'operationFailed':
      return {
        state: next,
        applied: true,
        needsResync: false,
        operationFailure: envelope.payload.data,
      };
  }

  return { state: next, applied: true, needsResync: false };
}

function unchanged(state: GraphViewState): ReduceResult {
  return { state, applied: false, needsResync: false };
}

function upsert<T extends { id: number }>(items: T[], item: T): T[] {
  const existing = items.findIndex((candidate) => candidate.id === item.id);
  if (existing < 0) return [...items, item];
  const next = [...items];
  next[existing] = item;
  return next;
}

function applyDelta(state: GraphViewState, delta: GraphDelta): void {
  switch (delta.type) {
    case 'nodeAdded':
    case 'nodeUpdated':
      state.nodes = upsert(state.nodes, delta.data);
      break;
    case 'nodeRemoved': {
      const portIds = new Set(
        state.ports.filter((port) => port.nodeId === delta.data.id).map((port) => port.id),
      );
      state.nodes = state.nodes.filter((node) => node.id !== delta.data.id);
      state.ports = state.ports.filter((port) => !portIds.has(port.id));
      state.links = state.links.filter(
        (link) => !portIds.has(link.outputPortId) && !portIds.has(link.inputPortId),
      );
      break;
    }
    case 'portAdded':
    case 'portUpdated':
      state.ports = upsert(state.ports, delta.data);
      break;
    case 'portRemoved':
      state.ports = state.ports.filter((port) => port.id !== delta.data.id);
      state.links = state.links.filter(
        (link) => link.outputPortId !== delta.data.id && link.inputPortId !== delta.data.id,
      );
      break;
    case 'linkAdded':
    case 'linkUpdated':
      state.links = upsert(state.links, delta.data);
      break;
    case 'linkRemoved':
      state.links = state.links.filter((link) => link.id !== delta.data.id);
      break;
    case 'defaultAudioSinkChanged':
      state.defaultAudioSinkName = delta.data.name;
      break;
    case 'defaultAudioSourceChanged':
      state.defaultAudioSourceName = delta.data.name;
      break;
  }
}
