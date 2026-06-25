const ELLIPSIS = "…";

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function characterWidth(character: string): number {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (
    codePoint === 0 ||
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint < 0xa0)
  ) {
    return 0;
  }
  if (codePoint === 0x200d || isCombiningCodePoint(codePoint)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

export function textColumns(value: string): number {
  let columns = 0;
  for (const character of value) columns += characterWidth(character);
  return columns;
}

export function takeColumns(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";

  let columns = 0;
  let result = "";
  for (const character of value) {
    const width = characterWidth(character);
    if (columns + width > maxColumns) break;
    columns += width;
    result += character;
  }
  return result;
}

export function truncateToColumns(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";
  if (textColumns(value) <= maxColumns) return value;
  if (maxColumns <= textColumns(ELLIPSIS)) return ELLIPSIS;

  const prefix = takeColumns(
    value,
    maxColumns - textColumns(ELLIPSIS),
  ).trimEnd();
  return `${prefix}${ELLIPSIS}`;
}
