export function fakeTimeRanges(ranges: Array<[number, number]>): TimeRanges {
  return {
    length: ranges.length,
    start(index: number): number {
      const range = ranges[index];
      if (!range) throw new DOMException('Index out of range', 'IndexSizeError');
      return range[0];
    },
    end(index: number): number {
      const range = ranges[index];
      if (!range) throw new DOMException('Index out of range', 'IndexSizeError');
      return range[1];
    },
  };
}

export interface FakeVideoOptions {
  buffered?: Array<[number, number]>;
  seekable?: Array<[number, number]>;
  currentTime?: number;
  playbackRate?: number;
  paused?: boolean;
}

export function fakeVideo({
  buffered = [],
  seekable = [],
  currentTime = 0,
  playbackRate = 1,
  paused = false,
}: FakeVideoOptions = {}): HTMLVideoElement {
  return {
    buffered: fakeTimeRanges(buffered),
    seekable: fakeTimeRanges(seekable),
    currentTime,
    playbackRate,
    paused,
    play: () => Promise.resolve(),
  } as unknown as HTMLVideoElement;
}
