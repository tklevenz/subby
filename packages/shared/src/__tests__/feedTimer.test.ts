import { describe, expect, it } from 'vitest';
import type { PayloadOf } from '../schemas/log.schema';
import { pauseFeed, sideSeconds, toggleSide } from '../domain/feedTimer';

const start: PayloadOf<'feed'> = { type: 'feed', method: 'breast' };
const s = (n: number) => n * 1000;

describe('feed timer', () => {
  it('accumulates per side across switches and pauses', () => {
    let p = toggleSide(start, 'left', 0);             // left running
    expect(sideSeconds(p, s(30))).toEqual({ left: 30, right: 0 });
    p = toggleSide(p, 'right', s(300));              // switch: 300 s left
    p = toggleSide(p, 'right', s(420));              // tap running side = pause: 120 s right
    expect(p.timerSide).toBeUndefined();
    expect(sideSeconds(p, s(9999))).toEqual({ left: 300, right: 120 });
    p = toggleSide(p, 'left', s(1000));              // resume left
    p = pauseFeed(p, s(1060));
    expect(p).toMatchObject({ leftSeconds: 360, rightSeconds: 120, lastSide: 'left' });
    expect(p.timerSideSince).toBeUndefined();
  });
});
