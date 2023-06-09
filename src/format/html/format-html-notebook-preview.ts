/*
 * format-html-notebook-preview.ts
 *
 * Copyright (C) 2020-2022 Posit Software, PBC
 */
import { asArray } from "../../core/array.ts";
import * as ld from "../../core/lodash.ts";

import {
  kDownloadUrl,
  kNotebookPreviewOptions,
} from "../../config/constants.ts";
import { Format, NotebookPreviewDescriptor } from "../../config/types.ts";

import { RenderServices } from "../../command/render/types.ts";

import { basename, dirname, isAbsolute, join, relative } from "path/mod.ts";
import { pathWithForwardSlashes } from "../../core/path.ts";
import { ProjectContext } from "../../project/types.ts";
import { projectIsBook } from "../../project/project-shared.ts";
import { kHtmlPreview } from "../../render/notebook/notebook-types.ts";
import { kRenderedIPynb } from "../../render/notebook/notebook-types.ts";
import { InternalError } from "../../core/lib/error.ts";

export interface NotebookPreview {
  title: string;
  href: string;
  filename?: string;
  supporting?: string[];
  resources?: string[];
}

export interface NotebookPreviewTask {
  input: string;
  nbPath: string;
  title?: string;
  nbPreviewFile?: string;
  callback?: (nbPreview: NotebookPreview) => void;
}

interface NotebookPreviewOptions {
  back?: boolean;
}

export const notebookPreviewer = (
  nbView: boolean | NotebookPreviewDescriptor | NotebookPreviewDescriptor[],
  format: Format,
  services: RenderServices,
  project?: ProjectContext,
  quiet?: boolean,
) => {
  const isBook = projectIsBook(project);
  const previewQueue: NotebookPreviewTask[] = [];

  const nbDescriptors: Record<string, NotebookPreviewDescriptor> = {};
  if (nbView) {
    if (typeof (nbView) !== "boolean") {
      asArray(nbView).forEach((view) => {
        const existingView = nbDescriptors[view.notebook];
        nbDescriptors[view.notebook] = {
          ...existingView,
          ...view,
        };
      });
    }
  }
  const descriptor = (
    notebook: string,
  ) => {
    return nbDescriptors[notebook];
  };

  const enQueuePreview = (
    input: string,
    nbPath: string,
    title?: string,
    nbPreviewFile?: string,
    callback?: (nbPreview: NotebookPreview) => void,
  ) => {
    previewQueue.push({ input, nbPath, title, nbPreviewFile, callback });
  };

  const renderPreviews = async (output?: string) => {
    const rendered: Record<string, NotebookPreview> = {};

    const nbOptions = format
      .metadata[kNotebookPreviewOptions] as NotebookPreviewOptions;

    // Render each notebook only once (so filter by
    // notebook path to consolidate the list)
    const uniqueWork = ld.uniqBy(
      previewQueue,
      (work: NotebookPreviewTask) => {
        return work.nbPath;
      },
    ) as NotebookPreviewTask[];

    const total = uniqueWork.length;
    for (let i = 0; i < total; i++) {
      const work = uniqueWork[i];
      const { nbPath, input, title, nbPreviewFile } = work;

      const nbDir = dirname(nbPath);
      const filename = basename(nbPath);
      const inputDir = dirname(input);

      if (nbView !== false) {
        // Read options for this notebook
        const descriptor: NotebookPreviewDescriptor | undefined =
          nbDescriptors[nbPath];
        const nbAbsPath = isAbsolute(nbPath) ? nbPath : join(inputDir, nbPath);
        const nbContext = services.notebook;
        const notebook = nbContext.get(nbAbsPath);
        const supporting: string[] = [];
        const resources: string[] = [];

        // Ensure this has an rendered ipynb and an html preview
        if (notebook && notebook[kHtmlPreview] && notebook[kRenderedIPynb]) {
        } else {
          // Render an ipynb
          if (
            (!notebook || !notebook[kRenderedIPynb]) &&
            !descriptor?.[kDownloadUrl]
          ) {
            const outIpynb = await nbContext.render(
              nbAbsPath,
              input,
              format,
              kRenderedIPynb,
              services,
              project,
            );
            if (outIpynb) {
              supporting.push(...outIpynb.supporting);
              resources.push(...outIpynb.resourceFiles.files);
            }
          }

          if (!notebook || !notebook[kHtmlPreview]) {
            const backHref = nbOptions && nbOptions.back && output
              ? relative(dirname(nbAbsPath), output)
              : undefined;

            const htmlOut = await nbContext.render(
              nbAbsPath,
              input,
              format,
              kHtmlPreview,
              services,
              project,
            );
            if (htmlOut.supporting) {
              supporting.push(...htmlOut.supporting);
            }
            if (htmlOut.resourceFiles.files) {
              resources.push(...htmlOut.resourceFiles.files);
            }
          }
        }

        const renderedNotebook = nbContext.get(nbAbsPath);
        if (!renderedNotebook || !renderedNotebook[kHtmlPreview]) {
          throw new InternalError(
            "We just ensured that notebooks had rendered previews, but they preview then didn't exist.",
          );
        }
        const nbPreview = {
          title: renderedNotebook.title ||
            "UNTITLED FIX ME",
          href: relative(inputDir, renderedNotebook[kHtmlPreview].path),
          supporting,
          resources,
        };
        rendered[work.nbPath] = nbPreview;
        if (work.callback) {
          work.callback(nbPreview);
        }
      } else {
        const nbPreview = {
          href: pathWithForwardSlashes(join(nbDir, filename)),
          title: title || filename,
          filename,
        };
        rendered[work.nbPath] = nbPreview;
        if (work.callback) {
          work.callback(nbPreview);
        }
      }
    }
    return rendered;
  };

  return {
    enQueuePreview,
    renderPreviews,
    descriptor,
  };
};
