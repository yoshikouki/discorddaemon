export function validateLimit(
  limit: number,
  min: number,
  max: number,
  label?: string
): void {
  if (!(limit >= min && limit <= max)) {
    throw new Error(label ?? `Limit must be ${min}-${max}`);
  }
}

export function validateOffset(offset: number): void {
  if (!(offset >= 0 && offset <= 9975)) {
    throw new Error("Offset must be 0-9975");
  }
}

export function validateMutuallyExclusive(
  values: Record<string, unknown>,
  keys: string[],
  label: string
): void {
  const present = keys.filter((k) => values[k]);
  if (present.length > 1) {
    throw new Error(label);
  }
}

export function validateRequired(
  value: unknown,
  message: string
): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

export function validateEnum(
  value: string,
  allowed: Set<string>,
  label: string
): void {
  if (!allowed.has(value)) {
    throw new Error(label);
  }
}

export function validateSearchFilters(args: {
  content?: string;
  authorIds: string[];
  authorType?: string;
  channelIds: string[];
  has?: string;
}): void {
  const hasFilter =
    args.content ||
    args.authorIds.length > 0 ||
    args.authorType ||
    args.channelIds.length > 0 ||
    args.has;
  if (!hasFilter) {
    throw new Error(
      "Search requires at least one filter: use --content, --author-id, --author-type, --channel-id, or --has"
    );
  }
}

export const VALID_HAS_VALUES = new Set([
  "link",
  "embed",
  "file",
  "video",
  "image",
  "sound",
]);

export const VALID_AUTHOR_TYPES = new Set(["user", "bot"]);
