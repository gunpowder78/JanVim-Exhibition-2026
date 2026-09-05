import { z } from "zod";

export type AgentCursorObservation = {
  schema: 1; type: "cursor"; loopId: string; cueId: string;
  seq: number; elapsedMs: number; row: number; cellCol: number;
  viewRow: number; viewCol: number; rows: number; cols: number;
};

// Match the authenticated Lua command identifiers (1..256 UTF-8 bytes).
const identifier = z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= 256);
const coordinate = z.number().int().min(0).max(1_000_000);
const dimension = z.number().int().min(1).max(65_536);
const observationSchema = z.object({
  schema: z.literal(1),
  type: z.literal("cursor"),
  loopId: identifier,
  cueId: identifier,
  seq: z.number().int().min(1).max(2_147_483_647),
  elapsedMs: z.number().finite().min(0).max(2_000),
  row: coordinate,
  cellCol: coordinate,
  viewRow: z.number().int().nonnegative(),
  viewCol: z.number().int().nonnegative(),
  rows: dimension,
  cols: dimension,
}).strict().refine((value) => value.viewRow < value.rows && value.viewCol < value.cols,
  "cursor viewport indices must be within rows and cols");

export function parseAgentCursorObservation(value: unknown): AgentCursorObservation {
  const observation = observationSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(observation), "utf8") > 1_024) {
    throw new Error("Cursor observation exceeds 1024 UTF-8 bytes");
  }
  return observation;
}
