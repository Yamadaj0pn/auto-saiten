import { GoogleGenAI } from "@google/genai";
import {
  gradingResultSchema,
  responseSchemaForGemini,
  type GradingResult,
} from "./schema";

const SYSTEM_PROMPT =
  "あなたは経験豊富な日本の学校教員で、手書き答案の採点を担当します。" +
  "提示された採点基準に厳密に従って公平に採点し、根拠を明確に示してください。" +
  "答案は手書きのため、文字認識は丁寧に行ってください。";

const GRADING_INSTRUCTION =
  "上の答案を採点基準に従って採点してください。\n" +
  "- 答案の手書き部分を正確に読み取り、模範解答と照合する\n" +
  "- 採点基準に部分点のルールがあればそれに従い、明示されていない場合も意味的に正しい部分には部分点を与える\n" +
  "- スペルミス・文法ミスは採点基準に従って減点する\n" +
  "- score_box は、答案内の「点数を記入する空欄(例: 『 /8点』のような枠)」の中心位置を返す:\n" +
  "  * page_number は点数欄があるページ番号(画像なら1、PDFなら該当ページの1始まり番号)\n" +
  "  * x, y は該当ページ内での正規化座標(左上=(0,0)、右下=(1,1))\n" +
  "  * 点数欄が見つからない場合は右下付近の妥当な位置を返す\n" +
  "- reasoning は配点の内訳を具体的に書く\n" +
  "- comments は生徒に向けた建設的なフィードバックにする";

export type FilePart = {
  kind: "file";
  data: string;
  mimeType: string;
};

export type CriteriaInput =
  | FilePart
  | { kind: "text"; content: string };

export interface GradeInput {
  answer: FilePart;
  criteria: CriteriaInput;
  model?: string;
}

export async function gradeAnswer(input: GradeInput): Promise<GradingResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません。");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = input.model ?? "gemini-2.5-pro";

  const parts: Array<
    { text: string } | { inlineData: { data: string; mimeType: string } }
  > = [{ text: "【採点基準】" }];

  if (input.criteria.kind === "file") {
    parts.push({
      inlineData: {
        data: input.criteria.data,
        mimeType: input.criteria.mimeType,
      },
    });
  } else {
    parts.push({ text: input.criteria.content });
  }

  parts.push({ text: "\n【生徒の答案】" });
  parts.push({
    inlineData: {
      data: input.answer.data,
      mimeType: input.answer.mimeType,
    },
  });
  parts.push({ text: GRADING_INSTRUCTION });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: responseSchemaForGemini,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini からのレスポンスが空でした。");
  }

  const json = JSON.parse(text);
  return gradingResultSchema.parse(json);
}
