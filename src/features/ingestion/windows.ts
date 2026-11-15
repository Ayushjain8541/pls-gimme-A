import { statSync } from "node:fs";
import { AppError } from "../../server/errors";
type PageImage = { page: number; imagePath: string };
/** Prefer complete-paper context; only large/image-heavy files need bounded windows. */
export function documentWindows<T extends PageImage>(pages: T[]) {
  const maxBytes = 20 * 1024 * 1024;
  const sizes = pages.map((p) => statSync(p.imagePath).size),
    totalPages = pages.length;
  const size = (first: number, end: number) =>
    sizes.slice(first, end).reduce((a, b) => a + b, 0);
  if (totalPages <= 20 && size(0, totalPages) <= maxBytes)
    return [
      {
        pages,
        completeDocument: true,
        totalPages,
        firstPrimaryPage: pages[0].page,
        lastPrimaryPage: pages.at(-1)!.page,
      },
    ];
  const windows: {
    pages: T[];
    completeDocument: boolean;
    totalPages: number;
    firstPrimaryPage: number;
    lastPrimaryPage: number;
  }[] = [];
  let first = 0;
  while (first < totalPages) {
    let end = Math.min(first + 4, totalPages),
      contextFirst = Math.max(0, first - 1),
      contextEnd = Math.min(totalPages, end + 1);
    if (size(contextFirst, contextEnd) > maxBytes) contextEnd = end;
    if (size(contextFirst, contextEnd) > maxBytes) contextFirst = first;
    while (end > first + 1 && size(contextFirst, contextEnd) > maxBytes) {
      end--;
      contextEnd = end;
    }
    if (size(contextFirst, contextEnd) > maxBytes)
      throw new AppError(
        "visual_limit",
        "A source page is too large for conversion. Upload a smaller PDF.",
        413,
      );
    windows.push({
      pages: pages.slice(contextFirst, contextEnd),
      completeDocument: false,
      totalPages,
      firstPrimaryPage: pages[first].page,
      lastPrimaryPage: pages[end - 1].page,
    });
    first = end;
  }
  return windows;
}
