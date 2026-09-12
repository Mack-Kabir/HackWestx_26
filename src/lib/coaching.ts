import { z } from "zod";

export const coachingSchema = z.object({
  exercise: z.enum(["squat", "other", "uncertain"]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1).max(1200),
  cues: z
    .array(
      z.object({
        observation: z.string().max(500),
        suggestion: z.string().max(500),
        timestamp: z.number().min(0).max(30),
      }),
    )
    .max(4),
  limitations: z.array(z.string().max(500)).min(1).max(4),
});
export type Coaching = z.infer<typeof coachingSchema>;
export const coachingInput = z.object({
  duration: z.number().min(3).max(30),
  coverage: z.number().min(0).max(1),
  reps: z
    .array(
      z.object({
        start: z.number().min(0).max(30),
        bottom: z.number().min(0).max(30),
        end: z.number().min(0).max(30),
        minKnee: z.number().min(0).max(180),
        maxLean: z.number().min(0).max(180),
        descent: z.number().min(0).max(30),
        ascent: z.number().min(0).max(30),
      }),
    )
    .max(90),
  keyframes: z
    .array(
      z.object({
        time: z.number().min(0).max(30),
        image: z
          .string()
          .max(250000)
          .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
      }),
    )
    .min(1)
    .max(6),
});
