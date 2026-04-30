import { NextRequest, NextResponse } from "next/server";
import { gradeAnswer, type CriteriaInput } from "@/lib/gemini";
import { annotateAnswer } from "@/lib/annotate";

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
]);

function detectMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".md")) return "text/markdown";
  return file.type || "application/octet-stream";
}

function isAnswerType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType) || mimeType === "application/pdf";
}

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

    const answerMimeType = detectMimeType(answerFile);
    const criteriaMimeType = detectMimeType(criteriaFile);

    if (!isAnswerType(answerMimeType)) {
      return NextResponse.json(
        {
          error: `答案は画像(JPEG/PNG/WebP)または PDF である必要があります。受信: ${answerMimeType}`,
        },
        { status: 400 },
      );
    }

    let criteria: CriteriaInput;
    if (
      IMAGE_MIME_TYPES.has(criteriaMimeType) ||
      criteriaMimeType === "application/pdf"
    ) {
      criteria = {
        kind: "file",
        data: await fileToBase64(criteriaFile),
        mimeType: criteriaMimeType,
      };
    } else if (TEXT_MIME_TYPES.has(criteriaMimeType)) {
      criteria = {
        kind: "text",
        content: await criteriaFile.text(),
      };
    } else {
      return NextResponse.json(
        {
          error: `採点基準は画像 / PDF / テキストファイルである必要があります。受信: ${criteriaMimeType}`,
        },
        { status: 400 },
      );
    }

    const answerArrayBuffer = await answerFile.arrayBuffer();
    const answerBuffer = Buffer.from(answerArrayBuffer);

    const result = await gradeAnswer({
      answer: {
        kind: "file",
        data: answerBuffer.toString("base64"),
        mimeType: answerMimeType,
      },
      criteria,
    });

    const annotated = await annotateAnswer(
      answerBuffer,
      answerMimeType,
      result.score,
      result.score_box,
    );
    const annotatedDataUrl = `data:${annotated.mimeType};base64,${annotated.buffer.toString("base64")}`;

    return NextResponse.json({
      ...result,
      annotated: {
        data_url: annotatedDataUrl,
        mime_type: annotated.mimeType,
        file_extension: annotated.fileExtension,
      },
    });
  } catch (error) {
    console.error("Grading error:", error);
    const message =
      error instanceof Error ? error.message : "採点中にエラーが発生しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
