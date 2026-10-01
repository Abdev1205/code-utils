import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getDoc } from "@/lib/understand";
import { lessonPrompt, writeLesson } from "@/lib/understand/lessons";
import { trackForDoc } from "@/lib/understand/roots";

const run = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Writes the lesson for one topic by shelling out to the Claude Code CLI, which
 * is already installed and authenticated on this machine — no API key needed.
 */
export async function POST(request: Request) {
  const { id, index } = await request.json();
  if (typeof id !== "string" || typeof index !== "number") {
    return Response.json({ error: "Expected { id, index }" }, { status: 400 });
  }

  const doc = await getDoc(id);
  if (!doc)
    return Response.json({ error: "Document not found" }, { status: 404 });

  const topic = doc.topics.find((t) => t.index === index);
  if (!topic)
    return Response.json({ error: "Topic not found" }, { status: 404 });

  const track = await trackForDoc(id);
  const prompt = lessonPrompt({
    moduleTitle: doc.summary.title,
    moduleGoal: doc.summary.summary,
    topic,
    trackContext: track?.context ?? "",
    trackName: track?.name ?? "this subject",
  });

  try {
    const { stdout } = await run(
      "claude",
      [
        "-p",
        prompt,
        "--model",
        process.env.UNDERSTAND_LESSON_MODEL ?? "sonnet",
      ],
      { timeout: 280_000, maxBuffer: 8 * 1024 * 1024, cwd: process.cwd() },
    );
    const body = stdout.trim();
    if (!body) throw new Error("Claude returned nothing");
    const saved = await writeLesson(id, topic, body);
    return Response.json(
      { lesson: body, lessonId: saved },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return Response.json(
      { error: `Generation failed: ${message}` },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
