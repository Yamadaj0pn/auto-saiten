import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface ScoreBox {
  page_number: number;
  x: number;
  y: number;
}

export interface AnnotatedResult {
  buffer: Buffer;
  mimeType: "image/jpeg" | "application/pdf";
  fileExtension: "jpg" | "pdf";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function annotateImage(
  imageBuffer: Buffer,
  score: number,
  scoreBox: ScoreBox,
): Promise<AnnotatedResult> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error("画像のサイズを取得できませんでした。");
  }

  const cx = Math.round(scoreBox.x * width);
  const cy = Math.round(scoreBox.y * height);
  const fontSize = Math.max(Math.floor(Math.min(width, height) * 0.05), 32);
  const text = escapeXml(String(score));

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text
        x="${cx}"
        y="${cy}"
        font-size="${fontSize}"
        font-weight="bold"
        font-family="sans-serif"
        fill="#dc1e1e"
        stroke="#dc1e1e"
        stroke-width="2"
        text-anchor="middle"
        dominant-baseline="central"
      >${text}</text>
    </svg>
  `;

  const buffer = await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buffer, mimeType: "image/jpeg", fileExtension: "jpg" };
}

async function annotatePdf(
  pdfBuffer: Buffer,
  score: number,
  scoreBox: ScoreBox,
): Promise<AnnotatedResult> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error("PDF にページがありません。");
  }

  const pageIndex = Math.min(
    Math.max(scoreBox.page_number - 1, 0),
    pages.length - 1,
  );
  const page = pages[pageIndex];
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = Math.max(Math.floor(Math.min(width, height) * 0.05), 24);
  const text = String(score);
  const textWidth = font.widthOfTextAtSize(text, fontSize);

  // PDF coords: bottom-left origin → flip y from top-left normalized
  const cx = scoreBox.x * width;
  const cy = height - scoreBox.y * height;

  page.drawText(text, {
    x: cx - textWidth / 2,
    y: cy - fontSize / 2,
    size: fontSize,
    font,
    color: rgb(0.86, 0.12, 0.12),
  });

  const out = await pdfDoc.save();
  return {
    buffer: Buffer.from(out),
    mimeType: "application/pdf",
    fileExtension: "pdf",
  };
}

export async function annotateAnswer(
  buffer: Buffer,
  mimeType: string,
  score: number,
  scoreBox: ScoreBox,
): Promise<AnnotatedResult> {
  if (mimeType === "application/pdf") {
    return annotatePdf(buffer, score, scoreBox);
  }
  return annotateImage(buffer, score, scoreBox);
}
