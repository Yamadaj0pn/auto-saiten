import { z } from "zod";

export const gradingResultSchema = z.object({
  student_answer: z.string(),
  score: z.number().int(),
  max_score: z.number().int(),
  reasoning: z.string(),
  comments: z.string(),
  score_box: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
});

export type GradingResult = z.infer<typeof gradingResultSchema>;

export const responseSchemaForGemini = {
  type: "object",
  properties: {
    student_answer: {
      type: "string",
      description: "OCR した生徒の答案(和訳・記述部分の文字起こし)",
    },
    score: { type: "integer", description: "採点による得点" },
    max_score: { type: "integer", description: "満点(配点)" },
    reasoning: {
      type: "string",
      description:
        "採点の根拠を採点基準と照合しながら詳細に説明。配点の内訳を明記する。",
    },
    comments: {
      type: "string",
      description: "生徒へのフィードバック・コメント",
    },
    score_box: {
      type: "object",
      properties: {
        x: {
          type: "number",
          description: "点数欄中心の x 座標(画像左端=0、右端=1)",
        },
        y: {
          type: "number",
          description: "点数欄中心の y 座標(画像上端=0、下端=1)",
        },
      },
      required: ["x", "y"],
    },
  },
  required: [
    "student_answer",
    "score",
    "max_score",
    "reasoning",
    "comments",
    "score_box",
  ],
};
