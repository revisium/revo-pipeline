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

export const unicodeCodePointLength = (value: string): number => {
  let length = 0;
  for (let index = 0; index < value.length; length += 1) {
    const point = value.codePointAt(index);
    index += point !== undefined && point > 0xffff ? 2 : 1;
  }
  return length;
};

export const compareUnicodeCodePoints = (left: string, right: string): number => {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) ?? 0;
    const rightPoint = right.codePointAt(rightIndex) ?? 0;
    const difference = leftPoint - rightPoint;
    if (difference !== 0) {
      return difference;
    }
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return Number(leftIndex < left.length) - Number(rightIndex < right.length);
};
