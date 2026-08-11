export const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length;) {
    const point = value.codePointAt(index);
    if (point === undefined || (point >= 0xd800 && point <= 0xdfff)) {
      return true;
    }
    index += point > 0xffff ? 2 : 1;
  }
  return false;
};

export const isNfcString = (value: string): boolean =>
  !hasUnpairedSurrogate(value) && value === value.normalize('NFC');

export const unicodeCodePointLength = (value: string): number => Array.from(value).length;

export const compareUnicodeCodePoints = (left: string, right: string): number => {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
};
