import { NextRequest, NextResponse } from "next/server";
import { gradeAnswer, type CriteriaInput } from "@/lib/gemini";
import { annotateScore } from "@/lib/annotate";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/octet-stream",
]);

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const answerFile = formData.get("answer");
    const criteriaFile = formData.get("criteria");

    if (!(answerFile instanceof File) || !(criteriaFile instanceof File)) {
      return NextResponse.json(
        { error: "answer と criteria の両方をアップロードしてください。" },
        { status: 400 },
      );
    }

    if (!IMAGE_MIME_TYPES.has(answerFile.type)) {
      return NextResponse.json(
        { error: `答案は画像ファイル(JPEG/PNG/WebP)である必要があります。受信: ${answerFile.type}` },
        { status: 400 },
      );
    }

    let criteria: CriteriaInput;
    if (IMAGE_MIME_TYPES.has(criteriaFile.type)) {
      criteria = {
        kind: "image",
        data: await fileToBase64(criteriaFile),
        mimeType: criteriaFile.type,
      };
    } else if (
      TEXT_MIME_TYPES.has(criteriaFile.type) ||
      criteriaFile.name.endsWith(".txt") ||
      criteriaFile.name.endsWith(".md")
    ) {
      criteria = {
        kind: "text",
        content: await criteriaFile.text(),
      };
    } else {
      return NextResponse.json(
        { error: `採点基準は画像またはテキストファイルである必要があります。受信: ${criteriaFile.type}` },
        { status: 400 },
      );
    }

    const answerArrayBuffer = await answerFile.arrayBuffer();
    const answerBuffer = Buffer.from(answerArrayBuffer);

    const result = await gradeAnswer({
      answerImage: {
        data: answerBuffer.toString("base64"),
        mimeType: answerFile.type,
      },
      criteria,
    });

    const annotatedBuffer = await annotateScore(
      answerBuffer,
      result.score,
      result.score_box,
    );
    const annotatedBase64 = annotatedBuffer.toString("base64");

    return NextResponse.json({
      ...result,
      annotated_image: `data:image/jpeg;base64,${annotatedBase64}`,
    });
  } catch (error) {
    console.error("Grading error:", error);
    const message =
      error instanceof Error ? error.message : "採点中にエラーが発生しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
