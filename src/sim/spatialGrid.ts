/** Growable slot list: query results, valid until the next write. */
export class SlotList {
  a = new Int32Array(64);
  n = 0;

  push(slot: number): void {
    if (this.n === this.a.length) {
      const g = new Int32Array(this.n * 2);
      g.set(this.a);
      this.a = g;
    }
    this.a[this.n++] = slot;
  }

  /** Ascending slot order (insertion sort: lists are short and nearly sorted). */
  sort(): void {
    const a = this.a;
    for (let i = 1; i < this.n; i++) {
      const v = a[i]!;
      let j = i - 1;
      while (j >= 0 && a[j]! > v) {
        a[j + 1] = a[j]!;
        j--;
      }
      a[j + 1] = v;
    }
  }
}

const NONE = -1;
const BIG = -2;

/** Uniform-grid broadphase over int slots (centre cell; radii over half a cell in a "big" list); queries return a superset. */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  /** Max radius of in-cell entries; queries widen by this. */
  readonly bigR: number;
  private head: Int32Array;
  private next = new Int32Array(0);
  private prev = new Int32Array(0);
  private cellOf = new Int32Array(0);
  private ex = new Float64Array(0);
  private ey = new Float64Array(0);
  private er = new Float64Array(0);
  private em = new Uint8Array(0);
  private big: number[] = [];
  private count = 0;

  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly x1: number,
    readonly y1: number,
    readonly cell: number,
    /** Position drift tolerated between updates. */
    readonly slack = 0
  ) {
    this.cols = Math.max(1, Math.ceil((x1 - x0) / cell));
    this.rows = Math.max(1, Math.ceil((y1 - y0) / cell));
    this.head = new Int32Array(this.cols * this.rows).fill(NONE);
    this.bigR = cell / 2;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.head.fill(NONE);
    this.cellOf.fill(NONE);
    this.big.length = 0;
    this.count = 0;
  }

  has(slot: number): boolean {
    return slot < this.cellOf.length && this.cellOf[slot] !== NONE;
  }

  insert(slot: number, x: number, y: number, r: number, mask: number): void {
    if (this.has(slot)) this.remove(slot);
    this.ensure(slot + 1);
    this.ex[slot] = x;
    this.ey[slot] = y;
    this.er[slot] = r;
    this.em[slot] = mask;
    this.count++;
    if (r > this.bigR) {
      this.cellOf[slot] = BIG;
      this.big.push(slot);
      return;
    }
    this.link(slot, this.cellAt(x, y));
  }

  /** New position; relinks only when the cell changes. */
  move(slot: number, x: number, y: number): void {
    this.ex[slot] = x;
    this.ey[slot] = y;
    const c = this.cellOf[slot]!;
    if (c < 0) return;
    const nc = this.cellAt(x, y);
    if (nc === c) return;
    this.unlink(slot, c);
    this.link(slot, nc);
  }

  setMask(slot: number, mask: number): void {
    this.em[slot] = mask;
  }

  maskOf(slot: number): number {
    return this.em[slot]!;
  }

  /** Indexed position (debug). */
  posOf(slot: number): { x: number; y: number } {
    return { x: this.ex[slot]!, y: this.ey[slot]! };
  }

  radiusOf(slot: number): number {
    return this.er[slot]!;
  }

  remove(slot: number): void {
    const c = this.cellOf[slot]!;
    if (c === NONE) return;
    if (c === BIG) this.big.splice(this.big.indexOf(slot), 1);
    else this.unlink(slot, c);
    this.cellOf[slot] = NONE;
    this.count--;
  }

  /** Append slots with `mask & m` whose centre is within `r` + their radius (+ slack) of (x, y). */
  query(x: number, y: number, r: number, m: number, out: SlotList): void {
    const reach = r + this.bigR + this.slack;
    const c0 = this.colAt(x - reach);
    const c1 = this.colAt(x + reach);
    const r0 = this.rowAt(y - reach);
    const r1 = this.rowAt(y + reach);
    const { head, next, ex, ey, er, em } = this;
    const base = r + this.slack;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0, cell = row * this.cols + c0; col <= c1; col++, cell++) {
        for (let i = head[cell]!; i !== NONE; i = next[i]!) {
          if (!(em[i]! & m)) continue;
          const dx = ex[i]! - x;
          const dy = ey[i]! - y;
          const lim = base + er[i]!;
          if (dx * dx + dy * dy <= lim * lim) out.push(i);
        }
      }
    }
    for (let k = 0; k < this.big.length; k++) {
      const i = this.big[k]!;
      if (!(em[i]! & m)) continue;
      const dx = ex[i]! - x;
      const dy = ey[i]! - y;
      const lim = base + er[i]!;
      if (dx * dx + dy * dy <= lim * lim) out.push(i);
    }
  }

  /** Entries in a cell (debug). */
  cellCount(col: number, row: number): number {
    let n = 0;
    for (let i = this.head[row * this.cols + col]!; i !== NONE; i = this.next[i]!) n++;
    return n;
  }

  /** Big-list slots (debug). */
  bigSlots(): readonly number[] {
    return this.big;
  }

  colAt(x: number): number {
    const c = Math.floor((x - this.x0) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  rowAt(y: number): number {
    const r = Math.floor((y - this.y0) / this.cell);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  private cellAt(x: number, y: number): number {
    return this.rowAt(y) * this.cols + this.colAt(x);
  }

  private link(slot: number, c: number): void {
    const h = this.head[c]!;
    this.next[slot] = h;
    this.prev[slot] = NONE;
    if (h !== NONE) this.prev[h] = slot;
    this.head[c] = slot;
    this.cellOf[slot] = c;
  }

  private unlink(slot: number, c: number): void {
    const p = this.prev[slot]!;
    const n = this.next[slot]!;
    if (p !== NONE) this.next[p] = n;
    else this.head[c] = n;
    if (n !== NONE) this.prev[n] = p;
  }

  private ensure(n: number): void {
    if (n <= this.cellOf.length) return;
    const cap = Math.max(n, this.cellOf.length * 2, 64);
    const grow = <T extends Int32Array | Float64Array | Uint8Array>(a: T, make: (n: number) => T, fill?: number): T => {
      const g = make(cap);
      if (fill != null) g.fill(fill);
      g.set(a);
      return g;
    };
    this.next = grow(this.next, (k) => new Int32Array(k));
    this.prev = grow(this.prev, (k) => new Int32Array(k));
    this.cellOf = grow(this.cellOf, (k) => new Int32Array(k), NONE);
    this.ex = grow(this.ex, (k) => new Float64Array(k));
    this.ey = grow(this.ey, (k) => new Float64Array(k));
    this.er = grow(this.er, (k) => new Float64Array(k));
    this.em = grow(this.em, (k) => new Uint8Array(k));
  }
}
