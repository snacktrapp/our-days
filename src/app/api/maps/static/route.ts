import sharp from "sharp";
import { parsePlaceCoordinates } from "@/lib/place-coordinates";
import {
  MAP_TILE_SIZE,
  mapTilerRasterTileUrl,
  mapTileViewport,
  serverMapTilerKey,
  STATIC_MAP_VIEW,
} from "@/features/composer/maptiler";
import { mapsApiHeaders, mapsApiText, mapTilerUpstreamInit } from "../response";

function clippedTile(
  originX: number,
  originY: number,
  left: number,
  top: number,
  viewWidth: number,
  viewHeight: number,
  tileWidth: number,
  tileHeight: number,
) {
  let srcLeft = 0;
  let srcTop = 0;
  let width = tileWidth;
  let height = tileHeight;
  let outX = Math.round(originX - left);
  let outY = Math.round(originY - top);
  if (outX < 0) {
    srcLeft = -outX;
    width += outX;
    outX = 0;
  }
  if (outY < 0) {
    srcTop = -outY;
    height += outY;
    outY = 0;
  }
  if (outX + width > viewWidth) width = viewWidth - outX;
  if (outY + height > viewHeight) height = viewHeight - outY;
  if (srcLeft + width > tileWidth) width = tileWidth - srcLeft;
  if (srcTop + height > tileHeight) height = tileHeight - srcTop;
  if (width < 1 || height < 1) return null;
  return {
    srcLeft,
    srcTop,
    width,
    height,
    left: outX,
    top: outY,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const coordinates = parsePlaceCoordinates(
    url.searchParams.get("lat"),
    url.searchParams.get("lng"),
  );
  if (!coordinates) return mapsApiText(400, "invalid_coordinates");

  const key = serverMapTilerKey();
  if (!key) return mapsApiText(503, "maptiler_key_missing");

  const viewport = mapTileViewport(
    coordinates.latitude,
    coordinates.longitude,
    key,
    STATIC_MAP_VIEW,
  );
  if (!viewport || viewport.tiles.length === 0) {
    return mapsApiText(400, "invalid_coordinates");
  }

  const init = mapTilerUpstreamInit(request);
  let tiles: {
    input: Buffer;
    left: number;
    top: number;
  }[];
  try {
    const fetched = await Promise.all(
      viewport.tiles.map(async (tile) => {
        const mapUrl = mapTilerRasterTileUrl(key, tile.z, tile.x, tile.y);
        const upstream = await fetch(mapUrl, init);
        if (!upstream.ok) {
          throw new Error(`maptiler_upstream_failed ${upstream.status}`);
        }
        const contentType = upstream.headers.get("content-type") ?? "";
        if (contentType && !contentType.startsWith("image/")) {
          throw new Error("maptiler_upstream_failed");
        }
        const data = Buffer.from(await upstream.arrayBuffer());
        const meta = await sharp(data).metadata();
        const tileWidth = meta.width ?? MAP_TILE_SIZE;
        const tileHeight = meta.height ?? MAP_TILE_SIZE;
        const clip = clippedTile(
          tile.originX,
          tile.originY,
          viewport.left,
          viewport.top,
          viewport.width,
          viewport.height,
          tileWidth,
          tileHeight,
        );
        if (!clip) return null;
        const input = await sharp(data)
          .extract({
            left: clip.srcLeft,
            top: clip.srcTop,
            width: clip.width,
            height: clip.height,
          })
          .png()
          .toBuffer();
        return { input, left: clip.left, top: clip.top };
      }),
    );
    tiles = fetched.filter((tile) => tile !== null);
    if (tiles.length === 0) return mapsApiText(502, "maptiler_upstream_failed");
  } catch (error) {
    const message =
      error instanceof Error &&
      error.message.startsWith("maptiler_upstream_failed")
        ? error.message
        : "maptiler_upstream_failed";
    return mapsApiText(502, message);
  }

  const png = await sharp({
    create: {
      width: viewport.width,
      height: viewport.height,
      channels: 3,
      background: { r: 223, g: 227, b: 213 },
    },
  })
    .composite(tiles)
    .png()
    .toBuffer();

  return new Response(png, {
    status: 200,
    headers: {
      ...mapsApiHeaders,
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
