import { generateWorld } from "./world";

type Req = { seed: number; tiles: (ImageData | null)[] };

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<Req>) => void) | null;
  postMessage: (msg: unknown, xfer?: Transferable[]) => void;
};

ctx.onmessage = (ev: MessageEvent<Req>) => {
  const world = generateWorld(ev.data.seed, ev.data.tiles, (t, label) => {
    ctx.postMessage({ type: "progress", t, label });
  });
  ctx.postMessage(
    { type: "done", world },
    [world.height.buffer, world.biome.buffer, world.terrain.data.buffer]
  );
};
