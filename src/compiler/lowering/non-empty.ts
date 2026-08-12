export const nonEmpty = <Value>(
  values: readonly Value[],
  message: string,
): readonly [Value, ...Value[]] => {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new TypeError(message);
  }
  return Object.freeze([first, ...rest]);
};

export const atLeastTwo = <Value>(
  values: readonly Value[],
  message: string,
): readonly [Value, Value, ...Value[]] => {
  const [first, second, ...rest] = values;
  if (first === undefined || second === undefined) {
    throw new TypeError(message);
  }
  return Object.freeze([first, second, ...rest]);
};
