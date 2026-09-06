/** Pixel occupancy evidence, not an artistic quality score. Monochrome assets are valid. */
export function measureWearableFramePixels(rgba, width, height) { // NOSONAR javascript:S3776
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || rgba.length !== width * height * 4) {
    return { foregroundPixels: 0, largestComponent: 0, occupiedWidth: 0, occupiedHeight: 0, nonblank: false };
  }
  const corners = [0, width - 1, (height - 1) * width, width * height - 1];
  const background = [0, 1, 2].map(channel => {
    const values = corners.map(pixel => rgba[pixel * 4 + channel]).sort((a, b) => a - b);
    return (values[1] + values[2]) / 2;
  });
  const mask = new Uint8Array(width * height);
  let foregroundPixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    const i = pixel * 4;
    if (rgba[i + 3] >= 200 && Math.max(...background.map((value, channel) => Math.abs(rgba[i + channel] - value))) > 24) {
      mask[pixel] = 1;
      foregroundPixels++;
    }
  }
  const queue = new Int32Array(mask.length);
  let largestComponent = 0, occupiedWidth = 0, occupiedHeight = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let begin = 0, end = 1, minX = width, maxX = 0, minY = height, maxY = 0;
    queue[0] = start; mask[start] = 2;
    while (begin < end) {
      const pixel = queue[begin++], x = pixel % width, y = Math.floor(pixel / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1, y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1];
      for (const neighbor of neighbors) if (neighbor >= 0 && mask[neighbor] === 1) { mask[neighbor] = 2; queue[end++] = neighbor; }
    }
    if (end > largestComponent) { largestComponent = end; occupiedWidth = maxX - minX + 1; occupiedHeight = maxY - minY + 1; }
  }
  return {
    foregroundPixels, largestComponent, occupiedWidth, occupiedHeight,
    nonblank: largestComponent >= Math.max(64, Math.ceil(width * height * 0.003)) && occupiedWidth >= 3 && occupiedHeight >= 3,
  };
}
