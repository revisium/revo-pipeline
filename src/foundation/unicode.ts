export const isNfcString = (value: string): boolean =>
  value.isWellFormed() && value === value.normalize('NFC');

export const unicodeCodePointLength = (value: string): number => {
  let length = 0;
  let index = 0;
  while (index < value.length) {
    const point = value.codePointAt(index);
    index += point !== undefined && point > 0xffff ? 2 : 1;
    length += 1;
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
