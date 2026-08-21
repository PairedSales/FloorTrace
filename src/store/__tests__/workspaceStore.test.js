import { beforeEach, describe, expect, it } from 'vitest';
import useWorkspaceStore from '../workspaceStore';
import useAppStore from '../appStore';

const ws = () => useWorkspaceStore.getState();

describe('workspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      showHelpModal: false,
      statusFlash: null,
      dockOpen: true,
      showExportDialog: false,
      confirmRequest: null,
    });
  });

  // The point of the split: switching plans must not disturb any of this, and
  // the only way that stays true is if none of it lives on the document store.
  it('keeps window state off the document store', () => {
    const app = useAppStore.getState();
    for (const key of [
      'showHelpModal', 'statusFlash', 'dockOpen', 'showExportDialog', 'confirmRequest',
      'setShowHelpModal', 'flashStatus', 'setDockOpen', 'setShowExportDialog',
      'requestConfirm', 'resolveConfirm',
    ]) {
      expect(app[key]).toBeUndefined();
    }
  });

  it('does not lose window state when the document store restarts', () => {
    ws().setDockOpen(false);
    ws().setShowHelpModal(true);

    useAppStore.getState().restart();

    expect(ws().dockOpen).toBe(false);
    expect(ws().showHelpModal).toBe(true);
  });

  describe('statusFlash', () => {
    it('makes two identical messages two separate flashes', () => {
      ws().flashStatus('Area copied');
      const first = ws().statusFlash;
      ws().flashStatus('Area copied');
      const second = ws().statusFlash;

      expect(second).not.toBe(first);
      expect(second.text).toBe('Area copied');
      expect(typeof second.at).toBe('number');
    });
  });

  describe('requestConfirm', () => {
    it('resolves a confirmation with the answer given', async () => {
      const answer = new Promise((resolve) => {
        ws().requestConfirm({ message: 'Close this plan?', resolve });
      });

      ws().resolveConfirm(true);

      await expect(answer).resolves.toBe(true);
      expect(ws().confirmRequest).toBeNull();
    });

    // This is the behaviour a "close every plan" loop has to be written around:
    // issuing N confirmations together answers N-1 of them `false` while showing
    // one dialog, so the loop must await each in turn.
    it('answers the incumbent false rather than stranding its promise', async () => {
      const first = new Promise((resolve) => {
        ws().requestConfirm({ message: 'Close plan 1?', resolve });
      });
      const second = new Promise((resolve) => {
        ws().requestConfirm({ message: 'Close plan 2?', resolve });
      });

      await expect(first).resolves.toBe(false);
      expect(ws().confirmRequest.message).toBe('Close plan 2?');

      ws().resolveConfirm(true);
      await expect(second).resolves.toBe(true);
    });

    it('ignores a resolve with nothing pending', () => {
      expect(() => ws().resolveConfirm(true)).not.toThrow();
      expect(ws().confirmRequest).toBeNull();
    });
  });
});
