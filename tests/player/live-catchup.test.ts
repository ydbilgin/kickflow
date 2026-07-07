import { describe, expect, it } from 'vitest';
import { decideCatchup, type CatchupAction } from '../../src/content/player/live-catchup';

describe('decideCatchup', () => {
  it('drops manual fast playback back to normal only at the live edge', () => {
    expect(decideCatchup({
      mode: 'manual',
      manualRate: 3,
      catchingUp: false,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'manualDropToNormal' });

    expect(decideCatchup({
      mode: 'manual',
      manualRate: 3,
      catchingUp: false,
      behindBy: 20,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });

    expect(decideCatchup({
      mode: 'manual',
      manualRate: 0.5,
      catchingUp: false,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });

    expect(decideCatchup({
      mode: 'manual',
      manualRate: 1,
      catchingUp: false,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });
  });

  it('auto mode crawls at 1.5x and resets at the edge without any snap action', () => {
    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: false,
      behindBy: 20,
      behindPlausible: true,
    })).toEqual({ kind: 'setRate', rate: 1.5 });

    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: true,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'setRate', rate: 1 });

    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: true,
      behindBy: 5,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });

    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: false,
      behindBy: 20,
      behindPlausible: false,
    })).toEqual({ kind: 'none' });

    const actionKinds: Array<CatchupAction['kind']> = ['none', 'setRate', 'manualDropToNormal'];
    expect(actionKinds).not.toContain('snap');
  });

  it('has no dvr suspend gate and no 15s snap branch in the pure decision', () => {
    const source = decideCatchup.toString();

    expect(source).not.toMatch(/dvr/i);
    expect(source).not.toMatch(/snap/i);
    expect(source).not.toContain('15');
  });
});
