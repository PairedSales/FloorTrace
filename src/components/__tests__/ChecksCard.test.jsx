// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import ChecksCard from '../ChecksCard';
import useAppStore from '../../store/appStore';
import { warning } from '../../utils/detection/scoring.js';

/**
 * The one card that says how much of the panel above it to believe. What is
 * asserted here is the property that made it worth building: the count beside
 * the chip is the number of things actually listed, and every reason is on the
 * page rather than in a `title` a phone can never show.
 */
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

const outline = (over = {}) => ({
  id: 'trace-1',
  name: '1st Floor',
  color: '#8b5cf6',
  visible: true,
  type: 'gla',
  vertices: square,
  holes: [],
  ...over,
});

const base = {
  image: 'data:image/png;base64,AAAA',
  perimeterTraces: [],
  activeTraceId: null,
  rooms: [],
  detectedDimensions: [],
  calibration: null,
  focusedWarning: null,
};

beforeEach(() => useAppStore.setState(base));
afterEach(cleanup);

describe('ChecksCard with nothing to say', () => {
  it('renders nothing at all before a plan is open', () => {
    useAppStore.setState({ image: null });
    const { container } = render(<ChecksCard />);
    expect(container.firstChild).toBeNull();
  });

  it('says nothing has been measured, rather than that everything is fine', () => {
    const view = render(<ChecksCard />);
    expect(view.getByText('Nothing yet')).toBeTruthy();
    expect(view.getByText(/Nothing measured yet/)).toBeTruthy();
  });

  it('reads clean once the work is done and the detector had no doubts', () => {
    useAppStore.setState({
      calibration: { calibrated: true, feetPerPixel: { x: 0.011, y: 0.011 } },
      perimeterTraces: [outline({ quality: { confidence: 0.92, warnings: [] } })],
    });
    const view = render(<ChecksCard />);
    expect(view.getByText('All clear')).toBeTruthy();
    expect(view.getByText(/Nothing to check/)).toBeTruthy();
    expect(view.getByText('92% confidence')).toBeTruthy();
  });
});

describe('ChecksCard statistics', () => {
  it('counts what the plan is measured from, read off the live store', () => {
    useAppStore.setState({
      rooms: [{}, {}, {}, {}, {}],
      detectedDimensions: [{}, {}, {}],
      calibration: { calibrated: true, feetPerPixel: { x: 0.011, y: 0.011 } },
      perimeterTraces: [outline(), outline({ id: 'trace-2', name: '2nd Floor', vertices: [] })],
    });
    const view = render(<ChecksCard />);
    expect(view.getByText('Dimension labels read').nextSibling.textContent).toBe('3');
    expect(view.getByText('Rooms measured').nextSibling.textContent).toBe('5');
    // An outline that exists but has never been traced is said as a fraction
    // rather than quietly dropped from the count.
    expect(view.getByText('Outlines traced').nextSibling.textContent).toBe('1 of 2');
    expect(view.getByText('Corners plotted').nextSibling.textContent).toBe('4');
  });

  it('separates the voids the user punched from the ones it found', () => {
    useAppStore.setState({
      perimeterTraces: [outline({
        holes: [{ ring: square, source: 'user' }, { ring: square }],
      })],
    });
    const view = render(<ChecksCard />);
    expect(view.getByText('Voids subtracted').nextSibling.textContent).toBe('2 (1 yours)');
  });
});

describe('ChecksCard on the scale', () => {
  const roomInternal = {
    calibrated: true,
    feetPerPixel: { x: 0.011, y: 0.011 },
    quality: { source: 'room', reason: 'room-internal', level: 'check', disagreement: Math.log(1.84) },
  };

  it('states the whole explanation on the page, not in a tooltip', () => {
    useAppStore.setState({ calibration: roomInternal });
    const view = render(<ChecksCard />);
    expect(view.getByText('Areas may be off by ~84%')).toBeTruthy();
    expect(view.getByText(/The scale was set from the average of the two/)).toBeTruthy();
    expect(view.getByText('1 to check')).toBeTruthy();
  });

  it('states a scale that agrees too, without counting it as a problem', () => {
    useAppStore.setState({
      calibration: {
        calibrated: true,
        feetPerPixel: { x: 0.011, y: 0.011 },
        quality: { source: 'auto', roomCount: 5, disagreement: Math.log(1.08) },
      },
      perimeterTraces: [outline({ quality: { confidence: 0.92, warnings: [] } })],
    });
    const view = render(<ChecksCard />);
    expect(view.getByText('Scale from 5 rooms')).toBeTruthy();
    expect(view.getByText('All clear')).toBeTruthy();
  });
});

describe('ChecksCard on the outlines', () => {
  const doubtful = {
    confidence: 0.62,
    warnings: [warning('bridged-opening', { px: 34 }), warning('no-inner', { floor: 0 })],
  };

  it('counts every reason it lists', () => {
    useAppStore.setState({ perimeterTraces: [outline({ quality: doubtful })] });
    const view = render(<ChecksCard />);
    expect(view.getByText('2 to check')).toBeTruthy();
    expect(view.getByText(/2 to check · a 34px opening was bridged/)).toBeTruthy();
  });

  it('keeps its reasons folded until asked, then names each one', () => {
    useAppStore.setState({ perimeterTraces: [outline({ quality: doubtful })] });
    const view = render(<ChecksCard />);
    expect(view.queryByText('Opening bridged')).toBeNull();
    fireEvent.click(view.getByText(/2 to check · /));
    expect(view.getByText('Opening bridged')).toBeTruthy();
    expect(view.getByText('No interior envelope')).toBeTruthy();
  });

  // The card exists to be turned to when something is wrong; an outline the
  // detector could not stand behind should not need a click to be readable.
  it('opens the outline the detector could not stand behind', () => {
    useAppStore.setState({
      perimeterTraces: [
        outline({ quality: { confidence: 0.9, warnings: [warning('no-inner', { floor: 0 })] } }),
        outline({
          id: 'trace-2',
          name: '2nd Floor',
          quality: { confidence: 0.3, warnings: [warning('unsealed', {}, 'error')] },
        }),
      ],
    });
    const view = render(<ChecksCard />);
    expect(view.getByText('Outline never closed')).toBeTruthy();
    expect(view.queryByText('No interior envelope')).toBeNull();
  });

  it('says when a void is no longer subtracted, which no detector warning does', () => {
    useAppStore.setState({
      perimeterTraces: [outline({
        holes: [{ ring: square, stale: true }],
        quality: { confidence: 0.92, warnings: [] },
      })],
    });
    const view = render(<ChecksCard />);
    expect(view.getByText('1 to check')).toBeTruthy();
    expect(view.getByText(/1 void is no longer inside this outline/)).toBeTruthy();
    expect(view.getByText('Voids left outside').nextSibling.textContent).toBe('1');
  });

  it('offers the plan a warning can point at, and toggles the highlight', () => {
    useAppStore.setState({
      perimeterTraces: [outline({
        quality: { confidence: 0.62, warnings: [warning('no-inner', { floor: 0 })] },
      })],
    });
    const view = render(<ChecksCard />);
    fireEvent.click(view.getByText(/1 to check · /));
    fireEvent.click(view.getByText('Show'));
    expect(useAppStore.getState().focusedWarning).toEqual({ traceId: 'trace-1', index: 0 });
    fireEvent.click(view.getByText('Show'));
    expect(useAppStore.getState().focusedWarning).toBeNull();
  });
});
