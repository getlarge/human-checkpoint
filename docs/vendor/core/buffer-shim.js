const encoder = new TextEncoder();
export const Buffer = {
  from(value) {
    return typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  },
  compare(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
  },
};
