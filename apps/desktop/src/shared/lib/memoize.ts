/**
 * Single-slot memoization for derived state. Store modules wrap their pure
 * derivations in this so every consumer (React selector hooks and plain
 * action functions alike) shares one cached computation per distinct set of
 * inputs — the module-level equivalent of a shared `useMemo`.
 */
export function memoizeOne<Args extends unknown[], Result>(
  compute: (...args: Args) => Result
): (...args: Args) => Result {
  let hasResult = false;
  let lastArgs: Args | null = null;
  let lastResult: Result;

  return (...args: Args) => {
    if (
      hasResult &&
      lastArgs &&
      lastArgs.length === args.length &&
      args.every((arg, index) => Object.is(arg, lastArgs![index]))
    ) {
      return lastResult;
    }
    lastResult = compute(...args);
    lastArgs = args;
    hasResult = true;
    return lastResult;
  };
}
