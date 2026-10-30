/**
 * Fine-grained reactivity: signals hold values, computeds derive from them,
 * effects react to them. Reads inside a computed or effect subscribe it; a
 * write re-runs exactly the effects that read the value, after the computeds
 * between them were brought up to date (no glitches, no wasted runs).
 *
 * Every computed, effect and root is an owner: what is created while it runs
 * (nested effects, `onCleanup` callbacks, context values) belongs to it and is
 * disposed when it re-runs or is disposed itself.
 */

/**
 * Reads a reactive value. Calling it inside a computed or effect subscribes
 * that computation to the value.
 *
 * @typeParam T The value's type.
 *
 * @category Reactivity
 */
export type Accessor<T> = () => T;

/**
 * A plain value or an {@linkcode Accessor} for one: what reactive props
 * accept. Function-typed values (callbacks, styles) are never accessors.
 *
 * @typeParam T The value's type.
 *
 * @category Reactivity
 */
export type MaybeAccessor<T> = T | Accessor<T>;

/**
 * A reactive value: call it to read (and subscribe), `set` or `update` it to
 * write. Writes that are equal to the current value (by `Object.is`, unless
 * {@linkcode SignalOptions.equals} says otherwise) notify no one.
 *
 * @typeParam T The value's type.
 *
 * @category Reactivity
 */
export interface Signal<T> extends Accessor<T> {
  /**
   * Replace the value and re-run what depends on it.
   *
   * @param value The new value.
   */
  set(value: T): void;
  /**
   * Replace the value with `fn` of the current one.
   *
   * @param fn Computes the new value from the current one.
   */
  update(fn: (value: T) => T): void;
  /** Read the value without subscribing. */
  peek(): T;
}

/**
 * Options of {@linkcode signal} and {@linkcode computed}.
 *
 * @typeParam T The value's type.
 *
 * @category Reactivity
 */
export interface SignalOptions<T> {
  /**
   * When a new value counts as unchanged, so dependants are not notified.
   * Default `Object.is`; `false` notifies on every write (useful for values
   * mutated in place).
   */
  equals?: false | ((previous: T, next: T) => boolean);
}

const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;
const MAX_FLUSH_RUNS = 100_000;

type State = typeof CLEAN | typeof CHECK | typeof DIRTY;
type Equals = false | ((previous: unknown, next: unknown) => boolean);

/** Something computations can depend on: a signal or a computed. */
interface Source {
  readonly observers: Set<Computation>;
}

/** Owns computations, cleanups and context values; disposing it disposes them. */
export class Owner {
  public readonly parent: Owner | null;
  public owned: Set<Owner> | null = null;
  public cleanups: (() => void)[] | null = null;
  public context: Map<symbol, unknown> | null = null;
  public disposed = false;

  public constructor(parent: Owner | null) {
    this.parent = parent;
  }
}

class SignalNode<T> implements Source {
  public readonly observers = new Set<Computation>();
  public value: T;
  public readonly equals: Equals;

  public constructor(value: T, equals: Equals) {
    this.value = value;
    this.equals = equals;
  }
}

class Computation<T = unknown> extends Owner implements Source {
  public readonly observers = new Set<Computation>();
  public readonly sources = new Set<Source>();
  public readonly fn: () => T;
  public readonly isEffect: boolean;
  public readonly equals: Equals;
  public value: T | undefined;
  public state: State = DIRTY;
  public initialized = false;

  public constructor(
    parent: Owner | null,
    fn: () => T,
    isEffect: boolean,
    equals: Equals,
  ) {
    super(parent);

    this.fn = fn;
    this.isEffect = isEffect;
    this.equals = equals;
  }
}

let currentOwner: Owner | null = null;
let currentObserver: Computation | null = null;
let batchDepth = 0;
let flushing = false;
const queue: Computation[] = [];

function equalsOption<T>(options: SignalOptions<T> | undefined): Equals {
  return options?.equals === undefined ? Object.is : options.equals as Equals;
}

function adopt(owner: Owner): void {
  const parent = owner.parent;

  if (parent !== null) {
    (parent.owned ??= new Set()).add(owner);
  }
}

function track(source: Source): void {
  if (currentObserver !== null) {
    currentObserver.sources.add(source);
    source.observers.add(currentObserver);
  }
}

/** Mark `node` at least `state` stale; the first mark queues effects and marks dependants for checking. */
function stale(node: Computation, state: State): void {
  if (node.state >= state || node.disposed) {
    return;
  }

  const wasClean = node.state === CLEAN;

  node.state = state;

  if (!wasClean) {
    return;
  }

  if (node.isEffect) {
    queue.push(node);
  }

  for (const observer of node.observers) {
    stale(observer, CHECK);
  }
}

function write<T>(node: SignalNode<T>, value: T): void {
  if (node.equals !== false && node.equals(node.value, value)) {
    return;
  }

  node.value = value;

  for (const observer of node.observers) {
    stale(observer, DIRTY);
  }

  if (batchDepth === 0) {
    flush();
  }
}

/** Bring `node` up to date: re-run it if a source changed, after refreshing the computeds it read. */
function refresh(node: Computation): void {
  if (node.disposed) {
    return;
  }

  if (node.state === CHECK) {
    for (const source of node.sources) {
      if (source instanceof Computation) {
        refresh(source);

        if ((node.state as State) === DIRTY) {
          break;
        }
      }
    }
  }

  if (node.state === DIRTY) {
    run(node);
  }

  node.state = CLEAN;
}

function run(node: Computation): void {
  clean(node);

  const owner = currentOwner;
  const observer = currentObserver;
  let value: unknown;

  currentOwner = node;
  currentObserver = node;

  try {
    value = node.fn();
  } finally {
    currentOwner = owner;
    currentObserver = observer;
  }

  if (node.isEffect) {
    if (typeof value === "function") {
      (node.cleanups ??= []).push(value as () => void);
    }

    return;
  }

  const changed = !node.initialized || node.equals === false ||
    !node.equals(node.value, value);

  node.value = value;
  node.initialized = true;

  if (!changed) {
    return;
  }

  for (const observer of node.observers) {
    observer.state = DIRTY;
  }
}

/** Dispose what `owner` owns, run its cleanups and, for a computation, drop its subscriptions. */
function clean(owner: Owner): void {
  const owned = owner.owned;
  const cleanups = owner.cleanups;
  let failure: { error: unknown } | undefined;

  owner.owned = null;
  owner.cleanups = null;

  if (owned !== null) {
    for (const child of owned) {
      try {
        disposeOwner(child);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  if (cleanups !== null) {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  if (owner instanceof Computation) {
    for (const source of owner.sources) {
      source.observers.delete(owner);
    }

    owner.sources.clear();
  }

  if (failure !== undefined) {
    throw failure.error;
  }
}

/** Dispose `owner` and everything it owns; it never runs again. */
export function disposeOwner(owner: Owner): void {
  if (owner.disposed) {
    return;
  }

  owner.disposed = true;

  owner.parent?.owned?.delete(owner);

  clean(owner);
}

function flush(): void {
  if (flushing) {
    return;
  }

  flushing = true;

  let runs = 0;
  let failure: { error: unknown } | undefined;

  try {
    while (queue.length > 0) {
      const effects = queue.splice(0);

      for (const effect of effects) {
        if (++runs > MAX_FLUSH_RUNS) {
          queue.length = 0;

          throw new Error(
            "Effects kept re-triggering each other; is an effect writing a signal it depends on through another effect?",
          );
        }

        try {
          refresh(effect);
        } catch (error) {
          effect.state = CLEAN;
          failure ??= { error };
        }
      }
    }
  } finally {
    flushing = false;
  }

  if (failure !== undefined) {
    throw failure.error;
  }
}

/** The owner new computations and cleanups attach to. */
export function getOwner(): Owner | null {
  return currentOwner;
}

/** Run `fn` with `owner` as the current owner and without a tracking observer. */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const owner0 = currentOwner;
  const observer0 = currentObserver;

  currentOwner = owner;
  currentObserver = null;

  try {
    return fn();
  } finally {
    currentOwner = owner0;
    currentObserver = observer0;
  }
}

/** A new owner under the current one, disposed with it. */
export function createOwner(): Owner {
  const owner = new Owner(currentOwner);

  adopt(owner);

  return owner;
}

/**
 * Create a signal.
 *
 * @typeParam T The value's type.
 * @param value The initial value.
 * @param options Equality used to skip writes that change nothing.
 * @returns The signal: call it to read, `set` / `update` to write.
 *
 * @example Count and derive
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { computed, signal } from "@neonbyte/tui/reactive";
 *
 * const count = signal(1);
 * const double = computed(() => count() * 2);
 *
 * count.set(5);
 * assertEquals(double(), 10);
 *
 * count.update((n) => n + 1);
 * assertEquals(double(), 12);
 * ```
 *
 * @category Reactivity
 */
export function signal<T>(value: T, options?: SignalOptions<T>): Signal<T> {
  const node = new SignalNode(value, equalsOption(options));
  const read = (() => {
    track(node);

    return node.value;
  }) as Signal<T>;

  read.set = (next) => write(node, next);
  read.update = (fn) => write(node, fn(node.value));
  read.peek = () => node.value;

  return read;
}

/**
 * Derive a value from signals and other computeds. It is computed lazily on
 * the first read, cached, and recomputed only when something it read changed
 * and someone reads it again.
 *
 * @typeParam T The value's type.
 * @param fn Computes the value; every signal it reads is a dependency.
 * @param options Equality used to tell dependants that nothing changed.
 * @returns An accessor of the derived value.
 *
 * @example Only recompute when needed
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { computed, signal } from "@neonbyte/tui/reactive";
 *
 * let runs = 0;
 * const name = signal("ada");
 * const upper = computed(() => {
 *   runs++;
 *
 *   return name().toUpperCase();
 * });
 *
 * assertEquals(upper(), "ADA");
 * assertEquals(upper(), "ADA");
 * assertEquals(runs, 1);
 * ```
 *
 * @category Reactivity
 */
export function computed<T>(
  fn: () => T,
  options?: SignalOptions<T>,
): Accessor<T> {
  const node = new Computation<T>(
    currentOwner,
    fn,
    false,
    equalsOption(options),
  );

  adopt(node);

  return () => {
    track(node);
    refresh(node);

    return node.value as T;
  };
}

/**
 * Run `fn` now and again whenever a signal or computed it read changes.
 * `fn` may return a cleanup function, which runs before the next run and when
 * the effect is disposed (as does everything registered with
 * {@linkcode onCleanup} and every effect created inside it).
 *
 * @param fn The side effect.
 * @returns A function that disposes the effect early. It is also disposed with
 * its owner.
 *
 * @example Log every change
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { effect, signal } from "@neonbyte/tui/reactive";
 *
 * const seen: number[] = [];
 * const count = signal(0);
 * const stop = effect(() => {
 *   seen.push(count());
 * });
 *
 * count.set(1);
 * count.set(1); // equal: no run
 * stop();
 * count.set(2);
 *
 * assertEquals(seen, [0, 1]);
 * ```
 *
 * @category Reactivity
 */
export function effect(fn: () => void | (() => void)): () => void {
  const node = new Computation(currentOwner, fn, true, false);

  adopt(node);
  run(node);

  node.state = CLEAN;

  return () => disposeOwner(node);
}

/**
 * Apply several writes, then run the effects they affect once.
 *
 * @typeParam T What `fn` returns.
 * @param fn Makes the writes.
 * @returns What `fn` returned.
 *
 * @example Update two signals with one effect run
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { batch, effect, signal } from "@neonbyte/tui/reactive";
 *
 * const first = signal("Ada");
 * const last = signal("Byron");
 * const seen: string[] = [];
 *
 * effect(() => {
 *   seen.push(`${first()} ${last()}`);
 * });
 * batch(() => {
 *   first.set("Grace");
 *   last.set("Hopper");
 * });
 *
 * assertEquals(seen, ["Ada Byron", "Grace Hopper"]);
 * ```
 *
 * @category Reactivity
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;

  try {
    return fn();
  } finally {
    batchDepth--;

    if (batchDepth === 0) {
      flush();
    }
  }
}

/**
 * Run `fn` without subscribing the current computation to what it reads.
 *
 * @typeParam T What `fn` returns.
 * @param fn Reads values.
 * @returns What `fn` returned.
 *
 * @example Read a signal without depending on it
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { effect, signal, untrack } from "@neonbyte/tui/reactive";
 *
 * const count = signal(0);
 * const label = signal("count");
 * const seen: string[] = [];
 *
 * effect(() => {
 *   seen.push(`${untrack(label)}: ${count()}`);
 * });
 * label.set("total"); // not a dependency: no run
 * count.set(1);
 *
 * assertEquals(seen, ["count: 0", "total: 1"]);
 * ```
 *
 * @category Reactivity
 */
export function untrack<T>(fn: () => T): T {
  const observer = currentObserver;

  currentObserver = null;

  try {
    return fn();
  } finally {
    currentObserver = observer;
  }
}

/**
 * Register `fn` to run when the current owner re-runs or is disposed: the
 * enclosing effect, computed, root or component tree. Does nothing outside
 * any owner.
 *
 * @param fn Releases what was set up: timers, listeners, subscriptions.
 *
 * @example Stop a timer with its effect
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { onCleanup, root } from "@neonbyte/tui/reactive";
 *
 * let stopped = false;
 *
 * root((dispose) => {
 *   const timer = setInterval(() => {}, 1000);
 *
 *   onCleanup(() => {
 *     clearInterval(timer);
 *     stopped = true;
 *   });
 *   dispose();
 * });
 *
 * assertEquals(stopped, true);
 * ```
 *
 * @category Reactivity
 */
export function onCleanup(fn: () => void): void {
  if (currentOwner !== null) {
    (currentOwner.cleanups ??= []).push(fn);
  }
}

/**
 * Run `fn` in a new owner that lives until `dispose` is called, independent
 * of the owner it was created in (whose context it still sees). Use it for
 * reactive code outside {@linkcode mount}.
 *
 * @typeParam T What `fn` returns.
 * @param fn Creates effects and components; receives the root's `dispose`.
 * @returns What `fn` returned.
 *
 * @example Dispose every effect at once
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { effect, root, signal } from "@neonbyte/tui/reactive";
 *
 * const count = signal(0);
 * const seen: number[] = [];
 * const dispose = root((dispose) => {
 *   effect(() => {
 *     seen.push(count());
 *   });
 *
 *   return dispose;
 * });
 *
 * dispose();
 * count.set(1);
 *
 * assertEquals(seen, [0]);
 * ```
 *
 * @category Reactivity
 */
export function root<T>(fn: (dispose: () => void) => T): T {
  const owner = new Owner(currentOwner);

  return runWithOwner(owner, () => fn(() => disposeOwner(owner)));
}

/**
 * Read a {@linkcode MaybeAccessor}: call it when it is an accessor.
 *
 * @typeParam T The value's type.
 * @param value A plain value or an accessor.
 * @returns The value.
 *
 * @example Accept plain and reactive values alike
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { read, signal } from "@neonbyte/tui/reactive";
 *
 * assertEquals(read(3), 3);
 * assertEquals(read(signal(4)), 4);
 * ```
 *
 * @category Reactivity
 */
export function read<T>(value: MaybeAccessor<T>): T {
  return typeof value === "function" ? (value as Accessor<T>)() : value;
}

/**
 * A value passed down the component tree without props; see
 * {@linkcode createContext}.
 *
 * @typeParam T The value's type.
 *
 * @category Reactivity
 */
export interface Context<T> {
  /** Identifies the context. */
  readonly id: symbol;
  /** Returned by {@linkcode useContext} when no provider is above. */
  readonly defaultValue: T;
}

/**
 * Create a context. Provide a value for a subtree with
 * {@linkcode Provider} (or {@linkcode provide} inside your own owner) and read
 * it with {@linkcode useContext}.
 *
 * @typeParam T The value's type.
 * @param defaultValue Read where no provider is above.
 * @returns The context.
 *
 * @example Read a default value
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { createContext, useContext } from "@neonbyte/tui/reactive";
 *
 * const Theme = createContext("dark");
 *
 * assertEquals(useContext(Theme), "dark");
 * ```
 *
 * @category Reactivity
 */
export function createContext<T>(defaultValue: T): Context<T> {
  return { id: Symbol("context"), defaultValue };
}

/**
 * Set `context` to `value` for everything the current owner creates from now
 * on. Inside JSX, use {@linkcode Provider}, which makes its own owner.
 *
 * @typeParam T The value's type.
 * @param context The context to set.
 * @param value Its value below the current owner.
 * @throws {Error} Outside any owner.
 *
 * @example Provide inside a root
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { createContext, provide, root, useContext } from "@neonbyte/tui/reactive";
 *
 * const Theme = createContext("dark");
 * const seen = root(() => {
 *   provide(Theme, "light");
 *
 *   return useContext(Theme);
 * });
 *
 * assertEquals(seen, "light");
 * ```
 *
 * @category Reactivity
 */
export function provide<T>(context: Context<T>, value: T): void {
  if (currentOwner === null) {
    throw new Error(
      "provide() needs an owner: call it inside root() or a component",
    );
  }

  (currentOwner.context ??= new Map()).set(context.id, value);
}

/**
 * Read the value of `context` provided nearest above the current owner.
 *
 * @typeParam T The value's type.
 * @param context The context to read.
 * @returns The provided value, or the context's default.
 *
 * @example Read a provided value
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { createContext, provide, root, useContext } from "@neonbyte/tui/reactive";
 *
 * const User = createContext<string | undefined>(undefined);
 *
 * root(() => {
 *   provide(User, "ada");
 *   assertEquals(useContext(User), "ada");
 * });
 * assertEquals(useContext(User), undefined);
 * ```
 *
 * @category Reactivity
 */
export function useContext<T>(context: Context<T>): T {
  for (let owner = currentOwner; owner !== null; owner = owner.parent) {
    if (owner.context?.has(context.id)) {
      return owner.context.get(context.id) as T;
    }
  }

  return context.defaultValue;
}
