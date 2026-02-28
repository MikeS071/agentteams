import { NextResponse } from "next/server";
import { z } from "zod";

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

export async function parseJSONBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<ValidationResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: "Invalid request body",
          issues: parsed.error.issues,
        },
        { status: 400 }
      ),
    };
  }

  return { success: true, data: parsed.data };
}

export function parseWithSchema<T>(
  value: unknown,
  schema: z.ZodType<T>,
  message = "Invalid request"
): ValidationResult<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: message,
          issues: parsed.error.issues,
        },
        { status: 400 }
      ),
    };
  }

  return { success: true, data: parsed.data };
}
