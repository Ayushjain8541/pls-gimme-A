export type UploadRole = "question" | "solution";
export function fileKey(file: Pick<File, "name" | "size" | "lastModified">) {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}
/** Picker additions and dropped files follow the same ordering, limits and deduplication. */
export function mergeFiles(
  current: File[],
  incoming: File[],
  role: UploadRole,
  maxCount = 40,
) {
  const files = [...current],
    known = new Set(current.map(fileKey)),
    errors: string[] = [];
  let duplicates = 0,
    overLimit = false;
  for (const file of incoming) {
    const key = fileKey(file);
    if (known.has(key)) {
      duplicates++;
      continue;
    }
    const pdf = /\.pdf$/i.test(file.name);
    const allowed =
      role === "question" ? pdf : /\.(pdf|txt|md|markdown)$/i.test(file.name);
    if (!allowed) {
      errors.push(
        `${file.name}: ${role === "question" ? "Choose a PDF question paper." : "Choose a PDF, text, or Markdown solution."}`,
      );
      continue;
    }
    if (file.size === 0) {
      errors.push(`${file.name}: This file is empty.`);
      continue;
    }
    const limit = pdf ? 25 * 1024 * 1024 : 1024 * 1024;
    if (file.size > limit) {
      errors.push(
        `${file.name}: ${pdf ? "PDF limit is 25 MiB." : "Text and Markdown limit is 1 MiB."}`,
      );
      continue;
    }
    if (files.length >= maxCount) {
      overLimit = true;
      continue;
    }
    files.push(file);
    known.add(key);
  }
  if (overLimit)
    errors.push(
      "You can select up to 40 files in one upload. Remove a file to make room.",
    );
  return { files, errors, duplicates };
}
