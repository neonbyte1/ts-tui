import {
  Image as ImageComponent,
  type ImageLabels,
  type ImageTheme,
} from "../../../mod.ts";
import type { MaybeAccessor } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Image}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Images
 */
export interface ImageProps extends RefProps<ImageComponent> {
  /** Contents of a PNG, JPEG, GIF or WebP file; reactive. */
  data: MaybeAccessor<Uint8Array>;
  /** Text shown in place of the image when it cannot be drawn; reactive. */
  alt?: MaybeAccessor<string | undefined>;
  /** Paints of the placeholder row; reactive. */
  theme?: MaybeAccessor<ImageTheme>;
  /** Maximum width in cells. */
  maxWidth?: number;
  /** Maximum height in cells. */
  maxHeight?: number;
  /** Texts of the placeholder row. */
  labels?: Partial<ImageLabels>;
}

/**
 * An inline image, or a one-row placeholder where the terminal cannot draw
 * it: the JSX form of the class component `Image`.
 *
 * @param props The image data, alt text, size limits and appearance.
 * @returns The image.
 *
 * @example Swap the shown image
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Image } from "@neonbyte/tui/reactive/components";
 *
 * // "GIF89a", then width and height as little-endian 16-bit numbers.
 * const small = new Uint8Array([71, 73, 70, 56, 57, 97, 3, 0, 2, 0]);
 * const large = new Uint8Array([71, 73, 70, 56, 57, 97, 9, 0, 4, 0]);
 * const data = signal(small);
 *
 * root(() => {
 *   const image = toComponent(
 *     <Image data={data} alt="logo" theme={{ fallback: {} }} />,
 *   );
 *
 *   assertEquals(image.render(40), ["[image: logo 3x2]"]);
 *
 *   data.set(large);
 *   assertEquals(image.render(40), ["[image: logo 9x4]"]);
 * });
 * ```
 *
 * @category Images
 */
export function Image(props: ImageProps): ImageComponent {
  const image = new ImageComponent(initial(props.data), {
    maxWidth: props.maxWidth,
    maxHeight: props.maxHeight,
    alt: props.alt === undefined ? undefined : initial(props.alt),
    theme: props.theme === undefined ? undefined : initial(props.theme),
    labels: props.labels,
  });

  watch(props.data, (value) => image.setData(value));
  watch(props.alt, (value) => image.setAlt(value));
  watch(props.theme, (value) => image.setTheme(value));

  return setup(image, props);
}
