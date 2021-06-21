/*
* website-meta.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { dirname, join, relative } from "path/mod.ts";
import {
  kDescription,
  kPageTitle,
  kTitle,
  kTitlePrefix,
} from "../../../config/constants.ts";
import { Format, FormatExtras } from "../../../config/format.ts";
import { Metadata } from "../../../config/metadata.ts";
import PngImage from "../../../core/png.ts";
import { ProjectContext } from "../../project-context.ts";
import { kSiteUrl } from "./website-config.ts";

const kTwitter = "twitter-card";
const kCard = "card";
const kCardStyle = "card-style";
const kCreator = "creator";
const kSite = "site";
const kPreview = "preview";
const kImage = "image";
const kImageWidth = "image-width";
const kImageHeight = "image-height";

const kOpenGraph = "opengraph";
const kLocale = "locale";
const kSiteName = "site-name";

export function resolveOpenGraphMetadata(
  source: string,
  project: ProjectContext,
  format: Format,
  extras: FormatExtras,
) {
  if (format.metadata[kOpenGraph]) {
    const openGraph = format.metadata[kOpenGraph];
    const ogMeta: Record<string, string | undefined> = {};
    if (openGraph) {
      // process explicitly set values
      if (openGraph && typeof (openGraph) === "object") {
        const ogData = openGraph as Record<string, unknown>;
        ogMeta[kImage] = ogData[kPreview] as string;
        ogMeta[kLocale] = ogData[kLocale] as string;
        ogMeta[kSiteName] = ogData[kSiteName] as string;
      }
    }
    // Write defaults if the user provided none
    resolveTitleDesc(format, extras, ogMeta);
    resolvePreviewImage(source, format, project, ogMeta);

    // Generate the opengraph meta
    const metadata: Record<string, string> = {};
    Object.keys(ogMeta).forEach((key) => {
      if (ogMeta[key] !== undefined) {
        const data = ogMeta[key] as string;
        if ([kImageWidth, kImageHeight].includes(key)) {
          key = key.replace("-", ":");
        }
        metadata[`og:${key}`] = data;
      }
    });
    return metadata;
  }
}

export function resolveTwitterMetadata(
  source: string,
  context: ProjectContext,
  format: Format,
  extras: FormatExtras,
) {
  // Twitter card
  if (format.metadata[kTwitter]) {
    const twitter = format.metadata[kTwitter];
    const twitterMeta: Record<string, string | undefined> = {};
    if (twitter) {
      // Process explicitly set values
      if (twitter && typeof (twitter) === "object") {
        const twData = twitter as Record<string, unknown>;
        twitterMeta[kCreator] = twData[kCreator] as string;
        twitterMeta[kSite] = twData[kSite] as string;
        twitterMeta[kImage] = twData[kPreview] as string;
        twitterMeta[kCard] = twData[kCardStyle] as string;
      }

      // Write defaults if the user provided none
      resolveTitleDesc(format, extras, twitterMeta);

      // Image
      resolvePreviewImage(source, format, context, twitterMeta);

      // Automatically choose the best format based upon whether
      // we have a preview image
      twitterMeta[kCard] =
        twitterMeta[kCardStyle] || twitterMeta[kImage] !== undefined
          ? "summary_large_image"
          : "summary";

      // trim contents if needed
      // See https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/markup
      const limits = [{
        key: kTitle,
        limit: 70,
      }, {
        key: kDescription,
        limit: 200,
      }];
      limits.forEach((limit) => {
        if (twitterMeta[limit.key] !== undefined) {
          twitterMeta[limit.key] = twitterMeta[limit.key]!.length > limit.limit
            ? twitterMeta[limit.key]?.substr(0, limit.limit)
            : twitterMeta[limit.key];
        }
      });
    }

    // Generate the twitter meta
    const metadata: Record<string, string> = {};
    Object.keys(twitterMeta).forEach((key) => {
      if (twitterMeta[key] !== undefined) {
        metadata[`twitter:${key}`] = twitterMeta[key] as string;
      }
    });
    return metadata;
  }
}

const kExplicitPreviewRegex =
  /!\[.*\]\((.*?(?:\.png|\.gif|\.jpg|\.jpeg|\.webp))\)\{.*.quarto-preview.*\}/;
const kNamedImageRegex =
  /!\[.*\]\((.*?(?:preview|feature|cover|thumbnail).*?(?:\.png|\.gif|\.jpg|\.jpeg|\.webp))\)\{.*\}/;
function findPreviewImage(
  source: string,
  _format: Format,
): { image: string; height?: number; width?: number } | undefined {
  const sourceMarkdown = Deno.readTextFileSync(source);

  let image = undefined;
  // look for an image explicitly marked as the preview image (.class .quarto-preview)
  const match = sourceMarkdown.match(kExplicitPreviewRegex);
  if (match) {
    image = match[1];
  }

  // look for an image with name feature, cover, or thumbnail
  if (image == undefined) {
    const namedMatch = sourceMarkdown.match(kNamedImageRegex);
    if (namedMatch) {
      image = namedMatch[1];
    }
  }

  if (image !== undefined) {
    if (image.endsWith(".png")) {
      const imageData = Deno.readFileSync(join(dirname(source), image));
      const png = new PngImage(imageData);
      return {
        image,
        height: png.height,
        width: png.width,
      };
    }
    return {
      image,
    };
  }

  // didn't find an image, sorry!
  return image;
}

function previewTitle(format: Format, extras: FormatExtras) {
  const meta = extras.metadata || {};
  if (meta[kPageTitle] !== undefined) {
    return meta[kPageTitle];
  } else if (meta[kTitlePrefix] !== undefined) {
    return meta[kTitlePrefix] + " - " + format.metadata[kTitle];
  } else {
    return format.metadata[kTitle];
  }
}

function resolvePreviewImage(
  source: string,
  format: Format,
  context: ProjectContext,
  metadata: Metadata,
) {
  // Image
  const siteMeta = format.metadata[kSite] as Metadata;
  if (siteMeta && siteMeta[kSiteUrl] !== undefined) {
    // Twitter images need to be full paths, so only do this if we have a
    // site url
    const image = findPreviewImage(source, format);
    if (image) {
      if (image.image.startsWith("/")) {
        // This is a project relative path
        metadata[kImage] = metadata[kImage] ||
          `${siteMeta[kSiteUrl]}${image.image}`;
      } else {
        // This is an input relative path
        const sourceRelative = relative(context.dir, source);
        const imageProjectRelative = join(
          dirname(sourceRelative),
          image.image,
        );
        // resolve the image path into an absolute href
        metadata[kImage] = metadata[kImage] ||
          `${siteMeta[kSiteUrl]}/${imageProjectRelative}`;
      }

      // set the image size
      metadata[kImageHeight] = String(image.height);
      metadata[kImageWidth] = String(image.width);
    }
  }
}

function resolveTitleDesc(
  format: Format,
  extras: FormatExtras,
  metadata: Metadata,
) {
  metadata[kTitle] = metadata[kTitle] ||
    previewTitle(format, extras) as string;
  metadata[kDescription] = metadata[kDescription] ||
    format.metadata.description as string;
}
