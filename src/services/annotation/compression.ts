import sharp from 'sharp';

export async function compressImage(
  imageBuffer: Buffer,
  maxSizeKB: number = 100
): Promise<Buffer> {
  let compressed = await sharp(imageBuffer)
    .png({
      compressionLevel: 9,
      palette: true,
      quality: 80,
      effort: 10,
    })
    .toBuffer();

  if (compressed.length / 1024 <= maxSizeKB) {
    return compressed;
  }

  const metadata = await sharp(imageBuffer).metadata();
  let currentWidth = metadata.width || 1440;
  const aspectRatio = (metadata.height || 900) / currentWidth;
  const MIN_WIDTH = 800;

  while (compressed.length / 1024 > maxSizeKB && currentWidth > MIN_WIDTH) {
    currentWidth = Math.round(currentWidth * 0.9);
    const newHeight = Math.round(currentWidth * aspectRatio);

    compressed = await sharp(imageBuffer)
      .resize(currentWidth, newHeight)
      .png({
        compressionLevel: 9,
        palette: true,
        quality: 70,
        effort: 10,
      })
      .toBuffer();
  }

  if (compressed.length / 1024 > maxSizeKB) {
    compressed = await sharp(imageBuffer)
      .resize(MIN_WIDTH, Math.round(MIN_WIDTH * aspectRatio))
      .jpeg({ quality: 70 })
      .toBuffer();
  }

  return compressed;
}

export async function getImageInfo(buffer: Buffer): Promise<{
  width: number;
  height: number;
  sizeKB: number;
  format: string;
}> {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    sizeKB: Math.round((buffer.length / 1024) * 100) / 100,
    format: metadata.format || 'unknown',
  };
}
