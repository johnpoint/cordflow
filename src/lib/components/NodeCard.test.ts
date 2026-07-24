import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { MessageKey } from '../i18n';
import NodeCard from './NodeCard.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  `${key}${values.id === undefined ? '' : ` ${values.id}`}`;

describe('NodeCard', () => {
  it('renders accessible media labels and the selected/compatible keyboard state', async () => {
    const onPortKeyDown = vi.fn();
    const onSelectNode = vi.fn();
    const { container, getByTestId, getByText } = render(NodeCard, {
      props: {
        node: { id: 10, name: 'Device', mediaName: 'Readable device', kind: 'duplex' },
        ports: [
          {
            id: 1,
            nodeId: 10,
            name: 'audio_out',
            direction: 'output',
            mediaType: 'audio',
          },
          {
            id: 2,
            nodeId: 10,
            name: 'midi_in',
            direction: 'input',
            mediaType: 'midi',
          },
          {
            id: 3,
            nodeId: 10,
            name: 'video_in',
            direction: 'input',
            mediaType: 'video',
          },
        ],
        selectedStartPortId: 1,
        compatibleTargetIds: new Set([2]),
        connectedPortIds: new Set([1]),
        focusedPortIds: new Set([1, 2]),
        focused: true,
        focusRoot: true,
        deemphasized: false,
        interactive: true,
        t,
        onPortPointerDown: vi.fn(),
        onPortKeyDown,
        onSelectNode,
      },
    });

    const selected = container.querySelector<HTMLButtonElement>('[data-port-id="1"]')!;
    const compatible = container.querySelector<HTMLButtonElement>('[data-port-id="2"]')!;
    const incompatible = container.querySelector<HTMLButtonElement>('[data-port-id="3"]')!;
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(compatible.classList.contains('port-button--compatible')).toBe(true);
    expect(selected.classList.contains('port-button--link-selected')).toBe(true);
    expect(compatible.classList.contains('port-button--link-selected')).toBe(true);
    expect(compatible.tabIndex).toBe(0);
    expect(incompatible.classList.contains('port-button--muted')).toBe(true);
    expect(incompatible.tabIndex).toBe(-1);
    expect(selected.title).toContain('Readable device');
    expect(container.querySelector('.node-card__title')?.getAttribute('title')).toBe(
      'Readable device',
    );
    expect(getByTestId('node-10').classList.contains('node-card--focus-root')).toBe(true);
    expect(getByText('ID 10').getAttribute('title')).toBe('nodeId 10');
    expect(getByText('MIDI')).toBeTruthy();
    expect(getByText('VID')).toBeTruthy();

    await fireEvent.keyDown(compatible, { key: 'Enter' });
    await fireEvent.click(getByTestId('node-select-10'));
    expect(onPortKeyDown).toHaveBeenCalledOnce();
    expect(onSelectNode).toHaveBeenCalledWith(10);
  });
});
