import { beforeEach, describe, expect, it } from 'vitest';
import useWorkspaceStore from '../workspaceStore';
import useAppStore from '../appStore';

const ws = () => useWorkspaceStore.getState();

describe('workspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      showHelpModal: false,
      statusFlash: null,
      notice: null,
      retraceOfferFor: null,
      panelOpen: true,
      showExportDialog: false,
      confirmRequest: null,
    });
  });

  // The point of the split: switching plans must not disturb any of this, and
  // the only way that stays true is if none of it lives on the document store.
  it('keeps window state off the document store', () => {
    const app = useAppStore.getState();
    for (const key of [
      'showHelpModal', 'statusFlash', 'notice', 'retraceOfferFor', 'panelOpen',
      'showExportDialog', 'confirmRequest',
      'setShowHelpModal', 'flashStatus', 'setNotice', 'dismissNotice', 'setRetraceOfferFor',
      'setPanelOpen', 'setShowExportDialog', 'requestConfirm', 'resolveConfirm',
    ]) {
      expect(app[key]).toBeUndefined();
    }
  });

  it('does not lose window state when the document store restarts', () => {
    ws().setPanelOpen(false);
    ws().setShowHelpModal(true);

    useAppStore.getState().restart();

    expect(ws().panelOpen).toBe(false);
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

    it('is green unless it is a refusal, and knows no third tone', () => {
      ws().flashStatus('Area copied');
      expect(ws().statusFlash.tone).toBe('ok');
      ws().flashStatus('Nothing painted', 'warn');
      expect(ws().statusFlash.tone).toBe('warn');
      ws().flashStatus('Anything else', 'purple');
      expect(ws().statusFlash.tone).toBe('ok');
    });
  });

  describe('notice', () => {
    it('holds one, replaced by the next and cleared by a dismissal', () => {
      ws().setNotice({ text: 'The first.', tone: 'warn' });
      const first = ws().notice;
      expect(first).toMatchObject({ text: 'The first.', tone: 'warn', action: null });
      expect(typeof first.at).toBe('number');

      ws().setNotice({ text: 'The second.' });
      expect(ws().notice).toMatchObject({ text: 'The second.', tone: 'crit' });

      ws().dismissNotice();
      expect(ws().notice).toBeNull();
    });
  });

  // An offer made on one plan must not follow the user to another: the store
  // holds which plan it is for, and the bar compares.
  describe('retraceOfferFor', () => {
    it('names the plan the offer is for, and is cleared with nothing', () => {
      ws().setRetraceOfferFor('doc-1');
      expect(ws().retraceOfferFor).toBe('doc-1');
      ws().setRetraceOfferFor(null);
      expect(ws().retraceOfferFor).toBeNull();
      ws().setRetraceOfferFor(undefined);
      expect(ws().retraceOfferFor).toBeNull();
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
