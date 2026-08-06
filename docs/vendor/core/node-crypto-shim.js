// Stand-in for node:crypto in the browser. The gate path never hashes; if
// this throws, the vendored module set needs a real Web Crypto implementation.
export function createHash() {
  throw new Error(
    'createHash is not available in the browser build. The gate path must not hash.',
  );
}
