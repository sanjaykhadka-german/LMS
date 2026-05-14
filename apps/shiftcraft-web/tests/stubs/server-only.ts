// Empty stub so test imports of files that do `import "server-only"` don't
// blow up under Node. The real package only exists to error if it leaks into
// a client bundle, which is irrelevant in vitest.
export {};
