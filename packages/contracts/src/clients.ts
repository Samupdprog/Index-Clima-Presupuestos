import { z } from "zod/v4";

export const createClientRequestSchema = z.object({
  name: z.string().trim().min(1),
  taxId: z.string().trim().optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export const updateClientRequestSchema = createClientRequestSchema.partial().extend({
  expectedRevision: z.number().int().nonnegative(),
});

export const searchClientsRequestSchema = z.object({
  q: z.string().trim().default(""),
});

export const deleteClientRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  deleteFromHolded: z.boolean().default(false),
}).strict();

export const syncClientRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();

export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;
export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
