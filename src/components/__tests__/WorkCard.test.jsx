// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import WorkCard from '../WorkCard';
import useAppStore, { computeAreaByType } from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { areaDisplayValue } from '../../utils/unitConverter';

/**
 * The card that shows the working for the area sketch. What is asserted here
 * is the pair of properties that make it worth showing at all: it is absent
 * until it is asked for, and the GLA it states is the one the Area card
 * headlines — the two sit on screen together, so a second definition would
 * print two square footages at once.
 */
const rect = (w, h) => ([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);

const trace = (over = {}) => ({
  id: 'trace-1',
  name: '1st Floor',
  color: '#BD93F9',
  type: 'gla',
  visible: true,
  vertices: rect(100, 50),
  holes: [],
  ...over,
});

// 1 ft = 10 px → the 100 x 50 px rectangle is 10 ft x 5 ft = 50 sq ft.
const base = {
  unit: 'decimal',
  perimeterTraces: [trace()],
  rooms: [],
  calibration: {
    calibrated: true,
    feetPerPixel: { x: 0.1, y: 0.1 },
    source: 'room-calibration',
    quality: { source: 'auto', level: 'ok', roomCount: 2 },
  },
};

beforeEach(() => {
  useAppStore.setState(base);
  useWorkspaceStore.setState({ showWork: true });
});
afterEach(cleanup);

describe('WorkCard is optional', () => {
  it('renders nothing while the preference is off', () => {
    useWorkspaceStore.setState({ showWork: false });
    const { container } = render(<WorkCard unit="decimal" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when nothing has been measured, even when asked for', () => {
    useAppStore.setState({ perimeterTraces: [trace({ visible: false })] });
    const { container } = render(<WorkCard unit="decimal" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('WorkCard shows the math', () => {
  it('prints the scale it converted with', () => {
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText('1 ft = 10.00 px')).toBeTruthy();
    expect(view.getByText('Measured from 2 rooms on this plan.')).toBeTruthy();
  });

  // The whole point of the card: the outline arrives as a multiply whose two
  // lengths are lengths of the building, checkable against the plan.
  it('cuts the outline into the multiply it is', () => {
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText('10.0 × 5.0')).toBeTruthy();
    expect(view.getByText('= 50.0')).toBeTruthy();
  });

  it('says nothing twice about a footprint that is one rectangle', () => {
    const view = render(<WorkCard unit="decimal" />);
    // The "overall 10.0 ft × 5.0 ft" line would be the single piece again.
    expect(view.queryByText(/overall/)).toBeNull();
  });

  it('states the GLA the Area card headlines', () => {
    const expected = areaDisplayValue(computeAreaByType(useAppStore.getState()).gla, 'decimal');
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText('Total living area (rounded)')).toBeTruthy();
    expect(view.getAllByText(`${expected.toLocaleString()} ft²`).length).toBeGreaterThan(0);
  });

  it('prints a column that adds to the figure over it', () => {
    useAppStore.setState({
      perimeterTraces: [trace({
        vertices: [
          { x: 0, y: 0 }, { x: 313, y: 0 }, { x: 313, y: 187 },
          { x: 140, y: 187 }, { x: 140, y: 264 }, { x: 0, y: 264 },
        ],
      })],
    });
    const view = render(<WorkCard unit="decimal" />);
    const rows = [...view.container.querySelectorAll('span')]
      .map((el) => el.textContent)
      .filter((t) => /^= −?[\d,.]+$/.test(t))
      .map((t) => Number(t.slice(2).replace(/,/g, '').replace('−', '-')));
    expect(rows.length).toBeGreaterThan(1);
    const summed = Number(rows.reduce((sum, v) => sum + v, 0).toFixed(1));
    expect(view.getByText(`${summed.toLocaleString(undefined, {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    })} ft²`)).toBeTruthy();
  });

  it('deducts a live void and says a stale one was not deducted', () => {
    useAppStore.setState({
      perimeterTraces: [trace({
        holes: [
          { id: 'h1', ring: rect(10, 10), source: 'user' },
          { id: 'h2', ring: rect(20, 10), source: 'user', stale: true },
        ],
      })],
    });
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText('= −1.0')).toBeTruthy();
    expect(view.getByText(/A void outside this outline was not deducted/)).toBeTruthy();
    // 5000 − 100 px² at 0.01 ft² per px² = 49 sq ft.
    expect(view.getAllByText('49 ft²').length).toBeGreaterThan(0);
  });

  it('adds two levels and shows the sum', () => {
    useAppStore.setState({
      perimeterTraces: [trace(), trace({ id: 'b', name: '2nd Floor', vertices: rect(80, 50) })],
    });
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText('Living area · 2 levels')).toBeTruthy();
    expect(view.getByText('2nd Floor')).toBeTruthy();
    expect(view.getByText('Levels added')).toBeTruthy();
    expect(view.getAllByText('90.0 ft²').length).toBeGreaterThan(0);
  });

  it('gives a non-living outline its own working and keeps it out of the GLA', () => {
    useAppStore.setState({
      perimeterTraces: [trace(), trace({ id: 'b', name: 'Garage', type: 'garage', vertices: rect(60, 40) })],
    });
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText('Not living area')).toBeTruthy();
    expect(view.getByText('Garage · Garage')).toBeTruthy();
    expect(view.getByText('6.0 × 4.0')).toBeTruthy();
    // GLA is the house alone, not the 74 the two add up to.
    expect(view.getAllByText('50 ft²').length).toBeGreaterThan(0);
  });

  it('says an outline is not counted rather than leaving it out', () => {
    useAppStore.setState({
      perimeterTraces: [trace(), trace({ id: 'b', name: 'Shed', visible: false })],
    });
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText(/Shed — hidden, so it is out of every total/)).toBeTruthy();
  });

  it('names the fallback assumption when no scale is set, and still works it', () => {
    useAppStore.setState({ calibration: null });
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText('No scale was set — areas are not to scale.')).toBeTruthy();
    expect(view.getByText(/assume 1 pixel = 1 foot/)).toBeTruthy();
    expect(view.getByText('1 ft = 1.00 px')).toBeTruthy();
    expect(view.getByText('100.0 × 50.0')).toBeTruthy();
  });

  it('withholds the working for an outline it cannot cut up, and keeps the area', () => {
    useAppStore.setState({
      perimeterTraces: [trace({
        vertices: [
          { x: 0, y: 0 }, { x: 100, y: 120 }, { x: 100, y: 0 }, { x: 0, y: 60 },
        ],
      })],
    });
    const view = render(<WorkCard unit="decimal" />);
    expect(view.getByText(/cannot be broken into pieces/)).toBeTruthy();
    expect(view.getByText('Total living area (rounded)')).toBeTruthy();
  });
});
