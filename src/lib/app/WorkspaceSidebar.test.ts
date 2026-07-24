import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate, type MessageKey } from '../i18n';
import WorkspaceSidebar from './WorkspaceSidebar.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('en', key, values);

describe('WorkspaceSidebar', () => {
  afterEach(cleanup);

  it('shows the mixer subnavigation in the right-side action slot', async () => {
    const onChangeMixerVolumeView = vi.fn();
    const { getByTestId, queryByTestId } = render(WorkspaceSidebar, {
      props: {
        workspaceView: 'mixer',
        advancedModeEnabled: false,
        graphStatus: { state: 'connected', detail: null },
        nodeCount: 2,
        portCount: 4,
        linkCount: 1,
        mixerVolumeView: 'devices',
        t,
        onChangeWorkspace: vi.fn(),
        onChangeMixerVolumeView,
        onOpenFlowBuilder: vi.fn(),
      },
    });

    expect(getByTestId('mixer-device-volume-tab').getAttribute('aria-selected')).toBe('true');
    expect(getByTestId('mixer-device-volume-tab').textContent).toBe('Device volume');
    expect(getByTestId('mixer-application-volume-tab').textContent).toBe('Application volume');
    expect(queryByTestId('flow-builder-open')).toBeNull();

    await fireEvent.click(getByTestId('mixer-application-volume-tab'));
    expect(onChangeMixerVolumeView).toHaveBeenCalledWith('applications');
  });
});
