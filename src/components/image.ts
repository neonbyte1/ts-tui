import { IMAGE_RESERVED } from "../ansi.ts";
import { type ImageProtocol, terminalInfo } from "../capabilities.ts";
import { type ImageInfo, readImageInfo } from "../image-format.ts";
import { type Paint, paint } from "../style.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth } from "../width.ts";

/**
 * Paints per element.
 *
 * @category Images
 */
export interface ImageTheme {
  /** The placeholder row shown when the image cannot be drawn. Default dim. */
  readonly fallback?: Paint;
}

/**
 * Fixed texts of the placeholder row.
 *
 * @category Images
 */
export interface ImageLabels {
  /** Shown when the data is not a recognised image. Default `[image]`. */
  readonly unknown: string;
  /** Shown for a recognised image: `alt` (control characters replaced, the format name when no `alt` is given) and the image's pixel size. Default `[image: ALT WxH]`. */
  readonly described: (alt: string, info: ImageInfo) => string;
}

const DEFAULT_THEME: Required<ImageTheme> = { fallback: { dim: true } };

const DEFAULT_LABELS: ImageLabels = {
  unknown: "[image]",
  described: (alt, info) => `[image: ${alt} ${info.widthPx}x${info.heightPx}]`,
};

/**
 * What an {@linkcode Image} shows and how large it may become.
 *
 * @category Images
 */
export interface ImageOptions {
  /** Maximum width in cells. */
  maxWidth?: number;
  /** Maximum height in cells. */
  maxHeight?: number;
  /** Text shown in place of the image when it cannot be drawn. */
  alt?: string;
  /** Paints of the placeholder row. */
  theme?: ImageTheme;
  /** Texts of the placeholder row. */
  labels?: Partial<ImageLabels>;
}

const KITTY_CHUNK = 4096;
const ID_LIMIT = 2 ** 32;

let nextImageId = 1 +
  crypto.getRandomValues(new Uint32Array(1))[0] % (2 ** 24 - 1);

function allocateImageId(): number {
  const id = nextImageId;

  nextImageId = id + 1 < ID_LIMIT ? id + 1 : 1;

  return id;
}

/**
 * Inline image drawn through the Kitty or iTerm2 graphics protocol, or a
 * one-row text placeholder when the terminal supports neither (see
 * {@linkcode terminalInfo}) or the data is not a recognised image.
 *
 * Kitty draws PNG only; iTerm2 draws any format it recognises. The image
 * keeps its aspect ratio and takes as many rows as it needs: the first row
 * carries the drawing and the rest hold {@linkcode IMAGE_RESERVED}.
 *
 * @category Images
 *
 * @example Show a placeholder where the terminal cannot draw images
 * ```ts
 * import { Image } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * // "GIF89a", then width 3 and height 2 as little-endian 16-bit numbers.
 * const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 3, 0, 2, 0]);
 * const image = new Image(gif, { alt: "logo", theme: { fallback: {} } });
 *
 * assertEquals(image.render(40), ["[image: logo 3x2]"]);
 * ```
 */
export class Image implements Component {
  private data: Uint8Array;
  private info: ImageInfo | null;
  private maxWidth: number | undefined;
  private maxHeight: number | undefined;
  private alt: string | undefined;
  private theme: Required<ImageTheme>;
  private readonly labels: ImageLabels;
  private id = allocateImageId();
  private base64: string | undefined;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Creates an image from encoded file contents. The format and size are read
   * from the header once, here.
   *
   * @param data Contents of a PNG, JPEG, GIF or WebP file.
   * @param options Size limits, alt text and placeholder look; see
   * {@linkcode ImageOptions}.
   */
  public constructor(data: Uint8Array, options: ImageOptions = {}) {
    this.data = data;
    this.info = readImageInfo(data);
    this.maxWidth = options.maxWidth;
    this.maxHeight = options.maxHeight;
    this.alt = options.alt;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
  }

  /**
   * Replaces some paints; others keep their values. Takes effect on the next
   * render.
   *
   * @param theme Paints to replace; see {@linkcode ImageTheme}.
   *
   * @example Restyle the placeholder
   * ```ts
   * import { Image } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const image = new Image(new Uint8Array(0), { theme: { fallback: {} } });
   *
   * assertEquals(image.render(20), ["[image]"]);
   *
   * image.setTheme({ fallback: { bold: true } });
   *
   * assertEquals(image.render(20), ["\x1b[1m[image]\x1b[22m"]);
   * ```
   */
  public setTheme(theme: ImageTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  /**
   * Replaces the shown image. The format and size are read from the header
   * again; takes effect on the next render.
   *
   * @param data Contents of a PNG, JPEG, GIF or WebP file.
   *
   * @example Swap the image
   * ```ts
   * import { Image } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * // "GIF89a", then width and height as little-endian 16-bit numbers.
   * const small = new Uint8Array([71, 73, 70, 56, 57, 97, 3, 0, 2, 0]);
   * const large = new Uint8Array([71, 73, 70, 56, 57, 97, 9, 0, 4, 0]);
   * const image = new Image(small, { theme: { fallback: {} } });
   *
   * assertEquals(image.render(40), ["[image: gif 3x2]"]);
   *
   * image.setData(large);
   *
   * assertEquals(image.render(40), ["[image: gif 9x4]"]);
   * ```
   */
  public setData(data: Uint8Array): void {
    this.data = data;
    this.info = readImageInfo(data);
    this.base64 = undefined;
    this.cacheKey = "";
  }

  /**
   * Replaces the text shown in place of an image that cannot be drawn.
   *
   * @param alt The new alt text, or `undefined` to show the format name.
   *
   * @example Describe the image
   * ```ts
   * import { Image } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * // "GIF89a", then width 3 and height 2 as little-endian 16-bit numbers.
   * const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 3, 0, 2, 0]);
   * const image = new Image(gif, { theme: { fallback: {} } });
   *
   * image.setAlt("logo");
   *
   * assertEquals(image.render(40), ["[image: logo 3x2]"]);
   * ```
   */
  public setAlt(alt: string | undefined): void {
    this.alt = alt;
    this.cacheKey = "";
  }

  /** Drops the cached rows so the next render recomputes them. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Renders the image, or its placeholder row, for the given width.
   *
   * @param width Available width in cells.
   * @returns The rows to draw; the same array until width, protocol or cell
   * size change.
   */
  public render(width: number): readonly string[] {
    const { imageProtocol, cellWidthPx, cellHeightPx } = terminalInfo;
    const info = this.info;
    const protocol: ImageProtocol | null =
      info && (imageProtocol === "iterm2" ||
          (imageProtocol === "kitty" && info.format === "png"))
        ? imageProtocol
        : null;
    const key = `${width}|${protocol}|${cellWidthPx}|${cellHeightPx}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    let rows: readonly string[];

    if (info && protocol) {
      rows = this.draw(info, protocol, width);
    } else {
      rows = [this.fallback(info, width)];
    }

    this.cacheKey = key;
    this.cache = rows;

    return rows;
  }

  /** Placeholder row for an image that cannot be drawn. */
  private fallback(info: ImageInfo | null, width: number): string {
    let text = this.labels.unknown;

    if (info) {
      const alt = (this.alt ?? info.format).replace(
        // deno-lint-ignore no-control-regex
        /[\x00-\x1f\x7f]/g,
        " ",
      );

      text = this.labels.described(alt, info);
    }

    return paint(truncateToWidth(text, width), this.theme.fallback);
  }

  /** Rows holding the drawing escape sequence for `protocol`, then the reserved rows. */
  private draw(
    info: ImageInfo,
    protocol: ImageProtocol,
    width: number,
  ): readonly string[] {
    const { cellWidthPx, cellHeightPx } = terminalInfo;
    const { widthPx, heightPx } = info;
    let cols = Math.max(
      1,
      Math.min(
        width,
        this.maxWidth ?? width,
        Math.ceil(widthPx / cellWidthPx),
      ),
    );
    let rows = Math.max(
      1,
      Math.round(cols * cellWidthPx * heightPx / widthPx / cellHeightPx),
    );

    if (this.maxHeight !== undefined && rows > this.maxHeight) {
      rows = Math.max(1, this.maxHeight);
      cols = Math.min(
        cols,
        Math.max(
          1,
          Math.round(rows * cellHeightPx * widthPx / heightPx / cellWidthPx),
        ),
      );
    }

    this.base64 ??= this.data.toBase64();

    const draw = protocol === "kitty"
      ? this.kitty(this.base64, cols, rows)
      : `\x1b]1337;File=inline=1;size=${this.data.byteLength};width=${cols};height=${rows};preserveAspectRatio=0:${this.base64}\x07`;
    const out = [draw];

    for (let i = 1; i < rows; i++) {
      out.push(IMAGE_RESERVED);
    }

    return out;
  }

  /** Kitty graphics escape sequences transmitting the image in base64 chunks. */
  private kitty(base64: string, cols: number, rows: number): string {
    let out = "";

    for (let offset = 0; offset < base64.length; offset += KITTY_CHUNK) {
      const more = offset + KITTY_CHUNK < base64.length ? 1 : 0;
      const control = offset === 0
        ? `a=T,f=100,t=d,i=${this.id},p=1,c=${cols},r=${rows},C=1,q=2,m=${more}`
        : `m=${more}`;

      out += `\x1b_G${control};${
        base64.slice(offset, offset + KITTY_CHUNK)
      }\x1b\\`;
    }

    return out;
  }
}
