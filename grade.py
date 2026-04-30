"""手書き答案を Gemini Vision で採点し、点数を画像に書き込むツール。"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

IMAGE_EXT_TO_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

JAPANESE_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/truetype/takao-gothic/TakaoGothic.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "C:/Windows/Fonts/YuGothB.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


class ScoreBox(BaseModel):
    """答案画像内の点数記入欄の中心座標(画像サイズで正規化、0〜1)。"""

    x: float = Field(description="点数欄中心の x 座標(画像左端=0、右端=1)")
    y: float = Field(description="点数欄中心の y 座標(画像上端=0、下端=1)")


class GradingResult(BaseModel):
    """採点結果。"""

    student_answer: str = Field(description="OCR した生徒の答案(和訳・記述部分の文字起こし)")
    score: int = Field(description="採点による得点")
    max_score: int = Field(description="満点(配点)")
    reasoning: str = Field(
        description=(
            "採点の根拠を採点基準と照合しながら詳細に説明する。"
            "どの観点で何点を与え、何点を減点したかを明記する。"
        )
    )
    comments: str = Field(description="生徒へのフィードバック・コメント(改善点や良い点)")
    score_box: ScoreBox = Field(
        description=(
            "答案画像内で「点数を書き込むべき枠」(例: 『  /8点』のような空欄部分)の"
            "中心の正規化座標。画像左上=(0,0)、右下=(1,1)。"
        )
    )


SYSTEM_PROMPT = (
    "あなたは経験豊富な日本の学校教員で、手書き答案の採点を担当します。"
    "提示された採点基準に厳密に従って公平に採点し、根拠を明確に示してください。"
    "答案画像は手書きのため、文字認識は丁寧に行ってください。"
)

GRADING_INSTRUCTION = (
    "上の答案を採点基準に従って採点してください。\n"
    "- 答案の手書き部分を正確に読み取り、模範解答と照合する\n"
    "- 採点基準に部分点のルールがあればそれに従い、明示されていない場合も"
    "意味的に正しい部分には部分点を与える\n"
    "- スペルミス・文法ミスは採点基準に従って減点する\n"
    "- score_box は、答案画像内の「点数を記入する空欄(例: 『 /8点』のような枠)」の"
    "中心位置を正規化座標で返す。点数欄が見つからない場合は右下付近の妥当な位置を返す\n"
    "- reasoning は配点の内訳を具体的に書く\n"
    "- comments は生徒に向けた建設的なフィードバックにする"
)


def load_image_part(path: Path) -> types.Part:
    suffix = path.suffix.lower()
    if suffix not in IMAGE_EXT_TO_MIME:
        raise ValueError(f"非対応の画像形式: {suffix}")
    return types.Part.from_bytes(data=path.read_bytes(), mime_type=IMAGE_EXT_TO_MIME[suffix])


def build_contents(answer_path: Path, criteria_path: Path) -> list:
    parts: list = []
    parts.append("【採点基準】")
    if criteria_path.suffix.lower() in IMAGE_EXT_TO_MIME:
        parts.append(load_image_part(criteria_path))
    else:
        parts.append(criteria_path.read_text(encoding="utf-8"))
    parts.append("\n【生徒の答案】")
    parts.append(load_image_part(answer_path))
    parts.append(GRADING_INSTRUCTION)
    return parts


def grade(answer_path: Path, criteria_path: Path, model: str) -> GradingResult:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise SystemExit("環境変数 GEMINI_API_KEY を設定してください。")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,
        contents=build_contents(answer_path, criteria_path),
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=GradingResult,
        ),
    )

    parsed = response.parsed
    if parsed is None:
        raise RuntimeError(
            f"採点結果のパースに失敗しました。レスポンス: {response.text!r}"
        )
    if isinstance(parsed, GradingResult):
        return parsed
    return GradingResult.model_validate(parsed)


def load_japanese_font(size: int) -> ImageFont.ImageFont:
    for path in JAPANESE_FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def annotate(answer_path: Path, result: GradingResult, out_path: Path) -> None:
    img = Image.open(answer_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    width, height = img.size

    cx = int(result.score_box.x * width)
    cy = int(result.score_box.y * height)

    font_size = max(int(min(width, height) * 0.05), 32)
    font = load_japanese_font(font_size)

    text = str(result.score)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    origin = (cx - tw // 2 - bbox[0], cy - th // 2 - bbox[1])

    red = (220, 30, 30)
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            draw.text((origin[0] + dx, origin[1] + dy), text, fill=red, font=font)

    img.save(out_path)


def write_report(answer_path: Path, result: GradingResult, out_path: Path) -> None:
    report = (
        f"# 採点結果: {answer_path.name}\n\n"
        f"## 得点\n\n**{result.score} / {result.max_score}**\n\n"
        f"## 答案(OCR)\n\n{result.student_answer}\n\n"
        f"## 採点の根拠\n\n{result.reasoning}\n\n"
        f"## 生徒へのコメント\n\n{result.comments}\n"
    )
    out_path.write_text(report, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="手書き答案を Gemini Vision で自動採点する。")
    parser.add_argument("--answer", required=True, type=Path, help="答案画像のパス")
    parser.add_argument(
        "--criteria",
        required=True,
        type=Path,
        help="採点基準(画像 .png/.jpg または テキスト .txt/.md)",
    )
    parser.add_argument("--out-dir", default=Path("output"), type=Path, help="出力先ディレクトリ")
    parser.add_argument(
        "--model",
        default="gemini-2.5-pro",
        help="使用する Gemini モデル(例: gemini-2.5-pro, gemini-2.5-flash)",
    )
    args = parser.parse_args()

    if not args.answer.exists():
        raise SystemExit(f"答案ファイルが見つかりません: {args.answer}")
    if not args.criteria.exists():
        raise SystemExit(f"採点基準ファイルが見つかりません: {args.criteria}")

    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"採点中: {args.answer.name} ...")
    result = grade(args.answer, args.criteria, args.model)

    graded_image_path = args.out_dir / f"{args.answer.stem}_graded{args.answer.suffix}"
    annotate(args.answer, result, graded_image_path)

    report_path = args.out_dir / f"{args.answer.stem}_report.md"
    write_report(args.answer, result, report_path)

    print()
    print(f"=== 採点結果: {args.answer.name} ===")
    print(f"得点: {result.score} / {result.max_score}")
    print()
    print("--- 採点の根拠 ---")
    print(result.reasoning)
    print()
    print("--- コメント ---")
    print(result.comments)
    print()
    print(f"採点済み画像: {graded_image_path}")
    print(f"レポート: {report_path}")


if __name__ == "__main__":
    main()
