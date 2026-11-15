import { z } from "zod";
export const BlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("markdown"),
    text: z.string().trim().min(1).max(100000),
  }),
  z.object({ kind: z.literal("asset"), assetId: z.string(), alt: z.string() }),
]);
export const BlocksSchema = z.array(BlockSchema);
export type Block = z.infer<typeof BlockSchema>;
export const SourceSchema = z.object({
  documentId: z.string(),
  page: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});
export type SourceRef = z.infer<typeof SourceSchema>;
