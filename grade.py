"""手書き答案を Claude Vision で採点し、点数を画像に書き込むツール。"""

from __future__ import annotations

import argparse
import base64
from pathlib import Path

import anthropic
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

IMAGE_EXT_TO_MEDIA = {
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

    x: float = Field(ge=0.0, le=1.0, description="点数欄中心の x 座標(画像左端=0、右端=1)")
    y: float = Field(ge=0.0, le=1.0, description="点数欄中心の y 座標(画像上端=0、下端=1)")


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


def encode_image(path: Path) -> tuple[str, str]:
    suffix = path.suffix.lower()
    if suffix not in IMAGE_EXT_TO_MEDIA:
        raise ValueError(f"非対応の画像形式: {suffix}")
    media_type = IMAGE_EXT_TO_MEDIA[suffix]
    data = base64.standard_b64encode(path.read_bytes()).decode("utf-8")
    return media_type, data


def build_user_content(answer_path: Path, criteria_path: Path) -> list[dict]:
    content: list[dict] = []

    content.append({"type": "text", "text": "【採点基準】"})
    if criteria_path.suffix.lower() in IMAGE_EXT_TO_MEDIA:
        media_type, data = encode_image(criteria_path)
        content.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": data},
                "cache_control": {"type": "ephemeral"},
            }
        )
    else:
        criteria_text = criteria_path.read_text(encoding="utf-8")
        content.append(
            {
                "type": "text",
                "text": criteria_text,
                "cache_control": {"type": "ephemeral"},
            }
        )

    content.append({"type": "text", "text": "\n【生徒の答案】"})
    media_type, data = encode_image(answer_path)
    content.append(
        {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        }
    )

    content.append(
        {
            "type": "text",
            "text": (
                "上の答案を採点基準に従って採点してください。\n"
                "- 答案の手書き部分を正確に読み取り、模範解答と照合する\n"
                "- 採点基準に部分点のルールがあればそれに従い、明示されていない場合も"
                "意味的に正しい部分には部分点を与える\n"
                "- スペルミス・文法ミスは採点基準に従って減点する\n"
                "- score_box は、答案画像内の「点数を記入する空欄(例: 『 /8点』のような枠)」の"
                "中心位置を正規化座標で返す。点数欄が見つからない場合は右下付近の妥当な位置を返す\n"
                "- reasoning は配点の内訳を具体的に書く\n"
                "- comments は生徒に向けた建設的なフィードバックにする"
            ),
        }
    )
    return content


SYSTEM_PROMPT = (
    "あなたは経験豊富な日本の学校教員で、手書き答案の採点を担当します。"
    "提示された採点基準に厳密に従って公平に採点し、根拠を明確に示してください。"
    "答案画像は手書きのため、文字認識は丁寧に行ってください。"
)


def grade(answer_path: Path, criteria_path: Path, model: str) -> GradingResult:
    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=model,
        max_tokens=8192,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_user_content(answer_path, criteria_path)}],
        output_format=GradingResult,
    )
    if response.parsed_output is None:
        raise RuntimeError(f"採点結果のパースに失敗しました。stop_reason={response.stop_reason}")
    return response.parsed_output


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
    parser = argparse.ArgumentParser(description="手書き答案を Claude Vision で自動採点する。")
    parser.add_argument("--answer", required=True, type=Path, help="答案画像のパス")
    parser.add_argument(
        "--criteria",
        required=True,
        type=Path,
        help="採点基準(画像 .png/.jpg または テキスト .txt/.md)",
    )
    parser.add_argument("--out-dir", default=Path("output"), type=Path, help="出力先ディレクトリ")
    parser.add_argument("--model", default="claude-opus-4-7", help="使用モデル")
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
