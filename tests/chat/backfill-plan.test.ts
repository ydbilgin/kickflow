import { describe, expect, it } from 'vitest';
import { captureOutage, planBackfill } from '../../src/content/chat/history';
import type { ChatMessage } from '../../src/content/chat/message-store';

const message = (n: number): ChatMessage => ({ id: `m${n}`, createdAt: new Date(n * 1000).toISOString(),
  sender: { id: 1 }, preserved: false } as ChatMessage);
describe('step 5: reconnect history window and gap estimate', () => {
  it('sorts late history and drops messages older than the oldest shown', () => {
    expect(planBackfill([message(4), message(1), message(3), message(2)], 2000, null).messages.map((m) => m.id))
      .toEqual(['m2', 'm3', 'm4']);
  });
  it('retains the complete initial history even when a live frame arrived first', () => {
    expect(planBackfill([message(1), message(2)], null, null).messages).toHaveLength(2);
  });
  it('estimates a missing interval from the measured pre-outage rate', () => {
    const boundary = captureOutage([message(1), message(2), message(3)]);
    expect(planBackfill([message(20), message(21)], 1000, boundary).gap)
      .toEqual({ at: 3001, count: 16, seconds: 17 });
  });
  it('marks one reconnect boundary with zero estimated loss when history overlaps', () => {
    const boundary = captureOutage([message(1), message(2), message(3)]);
    expect(planBackfill([message(2), message(3), message(4)], null, boundary).gap?.count).toBe(0);
  });
  it('uses an explicit time estimate if no message rate can be measured', () => {
    expect(planBackfill([message(10)], null, captureOutage([message(1)])).gap)
      .toEqual({ at: 1001, count: null, seconds: 9 });
  });
  it('does not mark an ordinary quiet-channel interval as missing messages', () => {
    expect(planBackfill([message(40)], null, captureOutage([message(10), message(20), message(30)])).gap?.count).toBe(0);
  });
});
