// Runs once on server startup (Next.js instrumentation hook).
//
// The googleapis / gaxios dependency still calls the deprecated Node `url.parse()`
// internally, which prints a noisy DEP0169 warning on every cold start. We can't
// change that third-party code, so we suppress ONLY that one deprecation code and
// let every other warning through untouched.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const original = process.emitWarning.bind(process);
  const isUrlParseDeprecation = (args: unknown[]) =>
    args.some(
      (a) =>
        a === "DEP0169" ||
        (a != null && typeof a === "object" && (a as { code?: string }).code === "DEP0169"),
    );

  // process.emitWarning has several overloads; forward everything we don't drop.
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (isUrlParseDeprecation(rest)) return;
    return (original as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
