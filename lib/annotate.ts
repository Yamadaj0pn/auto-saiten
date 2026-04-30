import sharp from "sharp";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function annotateScore(
  imageBuffer: Buffer,
  score: number,
  scoreBox: { x: number; y: number },
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
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

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
