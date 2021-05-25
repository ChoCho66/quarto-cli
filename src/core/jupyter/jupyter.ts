/*
* jupyter.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

// deno-lint-ignore-file camelcase

import { ensureDirSync } from "fs/ensure_dir.ts";
import { dirname, extname, join, relative } from "path/mod.ts";
import { walkSync } from "fs/walk.ts";
import { decode as base64decode } from "encoding/base64.ts";
import { stringify } from "encoding/yaml.ts";

import { ld } from "lodash/mod.ts";

import { warnOnce } from "../log.ts";
import { shortUuid } from "../uuid.ts";

import {
  extensionForMimeImageType,
  kApplicationJavascript,
  kApplicationRtf,
  kImagePng,
  kImageSvg,
  kRestructuredText,
  kTextHtml,
  kTextLatex,
} from "../mime.ts";

import PngImage from "../png.ts";

import {
  hideCell,
  hideCode,
  hideOutput,
  hideWarnings,
  includeCell,
  includeCode,
  includeOutput,
  includeWarnings,
} from "./tags.ts";
import {
  cellLabel,
  cellLabelValidator,
  resolveCaptions,
  shouldLabelCellContainer,
  shouldLabelOutputContainer,
} from "./labels.ts";
import {
  displayDataIsHtml,
  displayDataIsImage,
  displayDataIsJavascript,
  displayDataIsJson,
  displayDataIsLatex,
  displayDataIsMarkdown,
  displayDataMimeType,
  isCaptionableData,
  isDisplayData,
} from "./display_data.ts";
import {
  extractJupyterWidgetDependencies,
  JupyterWidgetDependencies,
} from "./widgets.ts";
import { removeAndPreserveHtml } from "./preserve.ts";
import { FormatExecute } from "../../config/format.ts";
import { pandocAsciify, pandocAutoIdentifier } from "../pandoc/pandoc-id.ts";
import { Metadata } from "../../config/metadata.ts";
import {
  kEcho,
  kError,
  kEval,
  kInclude,
  kOutput,
  kWarning,
} from "../../config/constants.ts";
import {
  isJupyterKernelspec,
  JupyterKernelspec,
  jupyterKernelspec,
  jupyterKernelspecs,
} from "./kernels.ts";
import { figuresDir, inputFilesDir } from "../render.ts";
import { lines } from "../text.ts";
import { readYamlFromMarkdownFile, readYamlFromString } from "../yaml.ts";

export const kCellCollapsed = "collapsed";
export const kCellAutoscroll = "autoscroll";
export const kCellDeletable = "deletable";
export const kCellFormat = "format";
export const kCellName = "name";
export const kCellTags = "tags";
export const kCellLinesToNext = "lines_to_next_cell";
export const kRawMimeType = "raw_mimetype";

export const kCellId = "id";
export const kCellLabel = "label";
export const kCellFigCap = "fig.cap";
export const kCellFigSubCap = "fig.subcap";
export const kCellFigScap = "fig.scap";
export const kCellFigLink = "fig.link";
export const kCellFigAlign = "fig.align";
export const kCellFigEnv = "fig.env";
export const kCellFigPos = "fig.pos";
export const kCellFigAlt = "fig.alt";
export const kCellLstLabel = "lst.label";
export const kCellLstCap = "lst.cap";
export const kCellClasses = "classes";
export const kCellOutWidth = "out.width";
export const kCellOutHeight = "out.height";
export const kCellFold = "fold";
export const kCellSummary = "summary";

export const kLayoutAlign = "layout.align";
export const kLayoutVAlign = "layout.valign";
export const kLayoutNcol = "layout.ncol";
export const kLayoutNrow = "layout.nrow";
export const kLayout = "layout";

export const kJupyterNotebookExtensions = [
  ".ipynb",
];
export function isJupyterNotebook(file: string) {
  return kJupyterNotebookExtensions.includes(extname(file).toLowerCase());
}

export interface JupyterNotebook {
  metadata: {
    kernelspec: JupyterKernelspec;
    widgets?: Record<string, unknown>;
    [key: string]: unknown;
  };
  cells: JupyterCell[];
  nbformat: number;
  nbformat_minor: number;
}

export interface JupyterCell {
  id: string;
  cell_type: "markdown" | "code" | "raw";
  execution_count?: null | number;
  metadata: JupyterCellMetadata;
  source: string[];
  outputs?: JupyterOutput[];
}

export interface JupyterCellMetadata {
  // nbformat v4 spec
  [kCellCollapsed]?: boolean;
  [kCellAutoscroll]?: boolean | "auto";
  [kCellDeletable]?: boolean;
  [kCellFormat]?: string; // for "raw"
  [kCellName]?: string; // optional alias for 'label'
  [kCellTags]?: string[];
  [kRawMimeType]?: string;

  // used to preserve line spacing
  [kCellLinesToNext]?: number;

  // anything else
  [key: string]: unknown;
}

export interface JupyterCellWithOptions extends JupyterCell {
  options: JupyterCellOptions;
}

export interface JupyterOutput {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  isolated?: boolean;
}

export interface JupyterOutputStream extends JupyterOutput {
  name: "stdout" | "stderr";
  text: string[];
}

export interface JupyterOutputDisplayData extends JupyterOutput {
  data: { [mimeType: string]: unknown };
  metadata: { [mimeType: string]: Record<string, unknown> };
  noCaption?: boolean;
}

export interface JupyterCellOptions extends JupyterOutputFigureOptions {
  [kCellLabel]?: string;
  [kCellFigCap]?: string | string[];
  [kCellFigSubCap]?: string[];
  [kCellLstLabel]?: string;
  [kCellLstCap]?: string;
  [kCellClasses]?: string;
  [kCellFold]?: string;
  [kCellSummary]?: string;
  [kEval]?: true | false | null;
  [kEcho]?: boolean;
  [kWarning]?: boolean;
  [kError]?: boolean;
  [kOutput]?: boolean;
  [kInclude]?: boolean;
}

export interface JupyterOutputFigureOptions {
  [kCellFigScap]?: string;
  [kCellFigLink]?: string;
  [kCellFigAlign]?: string;
  [kCellFigEnv]?: string;
  [kCellFigPos]?: string;
  [kCellFigAlt]?: string;
}

// option keys we handle internally so should not forward into generated markdown
export const kJupyterCellInternalOptionKeys = [
  kEval,
  kEcho,
  kWarning,
  kOutput,
  kInclude,
  kCellLabel,
  kCellClasses,
  kCellFold,
  kCellSummary,
  kCellFigCap,
  kCellFigSubCap,
  kCellFigScap,
  kCellFigLink,
  kCellFigAlign,
  kCellFigAlt,
  kCellFigEnv,
  kCellFigPos,
  kCellLstLabel,
  kCellLstCap,
  kCellOutWidth,
  kCellOutHeight,
];

export const kJupyterCellOptionKeys = kJupyterCellInternalOptionKeys.concat([
  kLayoutAlign,
  kLayoutVAlign,
  kLayoutNcol,
  kLayoutNrow,
  kLayout,
]);

export const kJupyterCellStandardMetadataKeys = [
  kCellCollapsed,
  kCellAutoscroll,
  kCellDeletable,
  kCellFormat,
  kCellName,
  kCellLinesToNext,
];

export interface JupyterOutputExecuteResult extends JupyterOutputDisplayData {
  execution_count: number;
}

export interface JupyterOutputError extends JupyterOutput {
  ename: string;
  evalue: string;
  traceback: string[];
}

export function quartoMdToJupyter(
  input: string,
  kernelspec: JupyterKernelspec,
  metadata: Metadata,
): JupyterNotebook {
  // notebook to return
  const nb: JupyterNotebook = {
    metadata: {
      kernelspec,
      ...metadata,
    },
    cells: [],
    nbformat: 4,
    nbformat_minor: 5,
  };

  // regexes
  const yamlRegEx = /^---\s*$/;
  /^\s*```+\s*\{([a-zA-Z0-9_]+)( *[ ,].*)?\}\s*$/;
  const startCodeCellRegEx = new RegExp(
    "^\\s*```+\\s*\\{" + kernelspec.language + "( *[ ,].*)?\\}\\s*$",
  );
  const startCodeRegEx = /^```/;
  const endCodeRegEx = /^```\s*$/;

  // read the file into lines
  const inputContent = Deno.readTextFileSync(input);

  // line buffer
  const lineBuffer: string[] = [];
  const flushLineBuffer = (
    cell_type: "markdown" | "code" | "raw",
  ) => {
    if (lineBuffer.length) {
      const cell: JupyterCell = {
        id: shortUuid(),
        cell_type,
        metadata: {},
        source: lineBuffer.map((line, index) => {
          return line + (index < (lineBuffer.length - 1) ? "\n" : "");
        }),
      };
      if (cell_type === "code") {
        // see if there is embedded metadata we should forward into the cell metadata
        const { yaml, source } = partitionJupyterCellOptions(
          kernelspec.language,
          cell.source,
        );
        if (yaml) {
          // use label as id if necessary
          if (yaml[kCellLabel] && !yaml[kCellId]) {
            yaml[kCellId] = jupyterAutoIdentifier(String(yaml[kCellLabel]));
          }

          const yamlKeys = Object.keys(yaml);
          yamlKeys.forEach((key) => {
            if (key === kCellId) {
              cell.id = String(yaml[key]);
              delete yaml[key];
            } else {
              if (!kJupyterCellOptionKeys.includes(key)) {
                cell.metadata[key] = yaml[key];
                delete yaml[key];
              }
            }
          });

          // if we hit at least one we need to re-write the source
          if (Object.keys(yaml).length < yamlKeys.length) {
            const cellYaml = stringify(yaml, {
              indent: 2,
              sortKeys: false,
              skipInvalid: true,
            });
            const commentChars = langCommentChars(kernelspec.language);
            const yamlOutput = lines(cellYaml).map((line) => {
              line = optionCommentPrefix(commentChars[0]) + line +
                optionCommentSuffix(commentChars[1]);
              return line + "\n";
            }).concat([""]);
            cell.source = yamlOutput.concat(source);
          }
        }

        // reset outputs and execution_count
        cell.execution_count = null;
        cell.outputs = [];
      }

      nb.cells.push(cell);
      lineBuffer.splice(0, lineBuffer.length);
    }
  };

  // loop through lines and create cells based on state transitions
  let inYaml = false, inCodeCell = false, inCode = false;
  for (const line of lines(inputContent)) {
    // yaml front matter
    if (yamlRegEx.test(line) && !inCodeCell && !inCode) {
      if (inYaml) {
        lineBuffer.push(line);
        flushLineBuffer("raw");
        inYaml = false;
      } else {
        flushLineBuffer("markdown");
        lineBuffer.push(line);
        inYaml = true;
      }
    } // begin code cell: ^```python
    else if (startCodeCellRegEx.test(line)) {
      flushLineBuffer("markdown");
      inCodeCell = true;

      // end code block: ^``` (tolerate trailing ws)
    } else if (endCodeRegEx.test(line)) {
      // in a code cell, flush it
      if (inCodeCell) {
        inCodeCell = false;
        flushLineBuffer("code");

        // otherwise this flips the state of in-code
      } else {
        inCode = !inCode;
        lineBuffer.push(line);
      }

      // begin code block: ^```
    } else if (startCodeRegEx.test(line)) {
      inCode = true;
      lineBuffer.push(line);
    } else {
      lineBuffer.push(line);
    }
  }

  // if there is still a line buffer then make it a markdown cell
  flushLineBuffer("markdown");

  return nb;
}

export async function jupyterKernelspecFromFile(
  file: string,
): Promise<[JupyterKernelspec, Metadata]> {
  const yaml = readYamlFromMarkdownFile(file);
  const yamlJupyter = yaml.jupyter;

  // if there is no yaml.jupyter then detect the file's language(s) and
  // find a kernelspec that supports this language
  if (!yamlJupyter) {
    const languages = languagesInMarkdownFile(file);
    const kernelspecs = await jupyterKernelspecs();
    for (const language of languages) {
      for (const kernelspec of kernelspecs.values()) {
        if (kernelspec.language === language) {
          return [kernelspec, {}];
        }
      }
    }
  }

  if (typeof (yamlJupyter) === "string") {
    const kernel = yamlJupyter;
    const kernelspec = await jupyterKernelspec(kernel);
    if (kernelspec) {
      return [kernelspec, {}];
    } else {
      return Promise.reject(
        new Error("Jupyter kernel '" + kernel + "' not found."),
      );
    }
  } else if (typeof (yamlJupyter) === "object") {
    const jupyter = { ...yamlJupyter } as Record<string, unknown>;
    if (isJupyterKernelspec(jupyter.kernelspec)) {
      const kernelspec = jupyter.kernelspec;
      delete jupyter.kernelspec;
      return [kernelspec, jupyter];
    } else if (typeof (jupyter.kernel) === "string") {
      const kernelspec = await jupyterKernelspec(jupyter.kernel);
      if (kernelspec) {
        delete jupyter.kernel;
        return [kernelspec, jupyter];
      } else {
        return Promise.reject(
          new Error("Jupyter kernel '" + jupyter.kernel + "' not found."),
        );
      }
    } else {
      return Promise.reject(
        new Error(
          "Invalid Jupyter kernelspec (must include name, language, & display_name)",
        ),
      );
    }
  } else {
    return Promise.reject(
      new Error(
        "Invalid jupyter YAML metadata found in file (must be string or object)",
      ),
    );
  }
}

export function jupyterFromFile(input: string): JupyterNotebook {
  // parse the notebook
  const nbContents = Deno.readTextFileSync(input);
  const nb = JSON.parse(nbContents) as JupyterNotebook;

  // validate that we have a language
  if (!nb.metadata.kernelspec.language) {
    throw new Error("No langage set for Jupyter notebook " + input);
  }

  // validate that we have cells
  if (!nb.cells) {
    throw new Error("No cells available in Jupyter notebook " + input);
  }

  return nb;
}

export function languagesInMarkdownFile(file: string) {
  return languagesInMarkdown(Deno.readTextFileSync(file));
}

export function languagesInMarkdown(markdown: string) {
  // see if there are any code chunks in the file
  const languages = new Set<string>();
  const kChunkRegex = /^[\t >]*```+\s*\{([a-zA-Z0-9_]+)( *[ ,].*)?\}\s*$/gm;
  kChunkRegex.lastIndex = 0;
  let match = kChunkRegex.exec(markdown);
  while (match) {
    const language = match[1];
    if (!languages.has(language)) {
      languages.add(language);
    }
    match = kChunkRegex.exec(markdown);
  }
  kChunkRegex.lastIndex = 0;
  return languages;
}

export function jupyterAutoIdentifier(label: string) {
  label = pandocAsciify(label);

  label = label
    // Replace all spaces with hyphens
    .replace(/\s/g, "-")
    // Remove invalid chars
    .replace(/[^a-zA-Z0-9-_]/g, "")
    // Remove everything up to the first letter
    .replace(/^[^A-Za-z]+/, "");

  // if it's empty then create a random id
  if (label.length > 0) {
    return label.slice(0, 64);
  } else {
    return shortUuid();
  }
}

export interface JupyterAssets {
  base_dir: string;
  files_dir: string;
  figures_dir: string;
  supporting_dir: string;
}

export function jupyterAssets(input: string, to?: string) {
  // calculate and create directories
  input = Deno.realPathSync(input);
  const files_dir = join(dirname(input), inputFilesDir(input));
  const figures_dir = join(files_dir, figuresDir(to));
  ensureDirSync(figures_dir);

  // determine supporting_dir (if there are no other figures dirs then it's
  // the files dir, otherwise it's just the figures dir). note that
  // supporting_dir is the directory that gets removed after a self-contained
  // or non-keeping render is complete
  let supporting_dir = files_dir;
  for (
    const walk of walkSync(join(files_dir), { maxDepth: 1 })
  ) {
    if (walk.path !== files_dir && walk.path !== figures_dir) {
      supporting_dir = figures_dir;
      break;
    }
  }

  const base_dir = dirname(input);
  return {
    base_dir,
    files_dir: relative(base_dir, files_dir),
    figures_dir: relative(base_dir, figures_dir),
    supporting_dir: relative(base_dir, supporting_dir),
  };
}

export interface JupyterToMarkdownOptions {
  language: string;
  assets: JupyterAssets;
  execute: FormatExecute;
  keepHidden?: boolean;
  toHtml?: boolean;
  toLatex?: boolean;
  toMarkdown?: boolean;
  figFormat?: string;
  figDpi?: number;
}

export interface JupyterToMarkdownResult {
  markdown: string;
  dependencies?: JupyterWidgetDependencies;
  htmlPreserve?: Record<string, string>;
}

export function jupyterToMarkdown(
  nb: JupyterNotebook,
  options: JupyterToMarkdownOptions,
): JupyterToMarkdownResult {
  // optional content injection / html preservation for html output
  const dependencies = options.toHtml
    ? extractJupyterWidgetDependencies(nb)
    : undefined;
  const htmlPreserve = options.toHtml ? removeAndPreserveHtml(nb) : undefined;

  // generate markdown
  const md: string[] = [];

  // validate unique cell labels as we go
  const validateCellLabel = cellLabelValidator();

  // track current code cell index (for progress)
  let codeCellIndex = 0;

  for (let i = 0; i < nb.cells.length; i++) {
    // convert cell yaml to cell metadata
    const cell = jupyterCellWithOptions(
      nb.metadata.kernelspec.language,
      nb.cells[i],
    );

    // validate unique cell labels
    validateCellLabel(cell);

    // markdown from cell
    switch (cell.cell_type) {
      case "markdown":
        md.push(...mdFromContentCell(cell));
        break;
      case "raw":
        md.push(...mdFromRawCell(cell, i === 0));
        break;
      case "code":
        md.push(...mdFromCodeCell(cell, ++codeCellIndex, options));
        break;
      default:
        throw new Error("Unexpected cell type " + cell.cell_type);
    }
  }

  // return markdown and any widget requirements
  return {
    markdown: md.join(""),
    dependencies,
    htmlPreserve,
  };
}

function jupyterCellWithOptions(
  language: string,
  cell: JupyterCell,
): JupyterCellWithOptions {
  const { yaml, source } = partitionJupyterCellOptions(language, cell.source);

  // read any options defined in cell metadata
  const metadataOptions: Record<string, unknown> = kJupyterCellOptionKeys
    .reduce((options, key) => {
      if (cell.metadata[key]) {
        options[key] = cell.metadata[key];
      }
      return options;
    }, {} as Record<string, unknown>);

  // combine metadata options with yaml options (giving yaml options priority)
  const options = {
    ...metadataOptions,
    ...yaml,
  };

  return {
    ...cell,
    source,
    options,
  };
}

function partitionJupyterCellOptions(language: string, source: string[]) {
  const commentChars = langCommentChars(language);
  const optionPrefix = optionCommentPrefix(commentChars[0]);
  const optionSuffix = commentChars[1] || "";

  // find the yaml lines
  const yamlLines: string[] = [];
  for (const line of source) {
    if (line.startsWith(optionPrefix)) {
      if (!optionSuffix || line.trimRight().endsWith(optionSuffix)) {
        let yamlOption = line.substring(optionPrefix.length);
        if (optionSuffix) {
          yamlOption = yamlOption.trimRight();
          yamlOption = yamlOption.substring(
            0,
            yamlOption.length - optionSuffix.length,
          );
        }
        yamlLines.push(yamlOption);
        continue;
      }
    }
    break;
  }

  let yaml = yamlLines.length > 0
    ? readYamlFromString(yamlLines.join("\n"))
    : undefined;

  // check that we got what we expected
  if (
    yaml !== undefined && (typeof (yaml) !== "object" || Array.isArray(yaml))
  ) {
    warnOnce("Invalid YAML option format in cell:\n" + yamlLines.join("\n"));
    yaml = undefined;
  }

  return {
    yaml: yaml as Record<string, unknown> | undefined,
    source: source.slice(yamlLines.length),
  };
}

function optionCommentPrefix(comment: string) {
  return comment + "| ";
}
function optionCommentSuffix(comment?: string) {
  if (comment) {
    return " " + comment;
  } else {
    return "";
  }
}

function langCommentChars(lang: string): string[] {
  const chars = kLangCommentChars[lang] || "#";
  if (!Array.isArray(chars)) {
    return [chars];
  } else {
    return chars;
  }
}

const kLangCommentChars: Record<string, string | string[]> = {
  r: "#",
  python: "#",
  julia: "#",
  scala: "//",
  matlab: "%",
  csharp: "//",
  fsharp: "//",
  c: ["/*", "*/"],
  css: ["/*", "*/"],
  sas: ["*", ";"],
  powershell: "#",
  bash: "#",
  sql: "--",
  mysql: "--",
  psql: "--",
  lua: "--",
  cpp: "//",
  cc: "//",
  stan: "#",
  octave: "#",
  fortran: "!",
  fortran95: "!",
  awk: "#",
  gawk: "#",
  stata: "*",
  java: "//",
  groovy: "//",
  sed: "#",
  perl: "#",
  ruby: "#",
  tikz: "%",
  js: "//",
  d3: "//",
  node: "//",
  sass: "//",
  coffee: "#",
  go: "//",
  asy: "//",
  haskell: "--",
  dot: "//",
};

function mdFromContentCell(cell: JupyterCellWithOptions) {
  return [...cell.source, "\n\n"];
}

function mdFromRawCell(cell: JupyterCellWithOptions, firstCell: boolean) {
  const mimeType = cell.metadata?.[kRawMimeType];
  if (mimeType) {
    switch (mimeType) {
      case kTextHtml:
        return mdHtmlOutput(cell.source);
      case kTextLatex:
        return mdLatexOutput(cell.source);
      case kRestructuredText:
        return mdFormatOutput("rst", cell.source);
      case kApplicationRtf:
        return mdFormatOutput("rtf", cell.source);
      case kApplicationJavascript:
        return mdScriptOutput(mimeType, cell.source);
    }
  }

  // if it's the first cell then it may be the yaml block, do some
  // special handling to remove any "jupyter" metadata so that if
  // the file is run through "quarto render" it's treated as a plain
  // markdown file
  if (firstCell) {
    return mdFromContentCell({
      ...cell,
      source: cell.source.filter((line) => {
        return !/^jupyter:\s+true\s*$/.test(line);
      }),
    });
  } else {
    return mdFromContentCell(cell);
  }
}

function mdFromCodeCell(
  cell: JupyterCellWithOptions,
  cellIndex: number,
  options: JupyterToMarkdownOptions,
) {
  // bail if we aren't including this cell
  if (!includeCell(cell, options)) {
    return [];
  }

  // redact if the cell has no source and no output
  if (!cell.source.length && !cell.outputs?.length) {
    return [];
  }

  // markdown to return
  const md: string[] = [];

  // write div enclosure
  const divMd: string[] = [`::: {`];

  // metadata to exclude from cell div attributes
  const kCellOptionsFilter = kJupyterCellInternalOptionKeys.concat(
    kJupyterCellStandardMetadataKeys,
  );

  // determine label -- this will be forwarded to the output (e.g. a figure)
  // if there is a single output. otherwise it will included on the enclosing
  // div and used as a prefix for the individual outputs
  const label = cellLabel(cell);
  const labelCellContainer = shouldLabelCellContainer(cell, options);
  if (label && labelCellContainer) {
    divMd.push(`${label} `);
  }

  // resolve caption (main vs. sub)
  const { cellCaption, outputCaptions } = resolveCaptions(cell);

  // cell_type classes
  divMd.push(`.cell `);

  // add hidden if requested
  if (hideCell(cell, options)) {
    divMd.push(`.hidden `);
  }

  // css classes
  if (cell.options[kCellClasses]) {
    const cellClasses = cell.options[kCellClasses]!;
    const classes = Array.isArray(cellClasses) ? cellClasses : [cellClasses];
    const classText = classes
      .map((clz: string) => {
        clz = ld.toString(clz);
        return clz.startsWith(".") ? clz : ("." + clz);
      })
      .join(" ");
    divMd.push(classText + " ");
  }

  // forward other attributes we don't know about (combine attributes
  // from options yaml and cell metadata)
  const cellOptions = {
    ...cell.metadata,
    ...cell.options,
  };

  for (const key of Object.keys(cellOptions)) {
    if (!kCellOptionsFilter.includes(key.toLowerCase())) {
      // deno-lint-ignore no-explicit-any
      const value = (cellOptions as any)[key];
      if (value) {
        divMd.push(`${key}="${value}" `);
      }
    }
  }

  // create string for div enclosure (we'll use it later but
  // only if there is actually content in the div)
  const divBeginMd = divMd.join("").replace(/ $/, "").concat("}\n");

  // write code if appropriate
  if (includeCode(cell, options)) {
    md.push("``` {");
    if (typeof cell.options[kCellLstLabel] === "string") {
      let label = cell.options[kCellLstLabel]!;
      if (!label.startsWith("#")) {
        label = "#" + label;
      }
      md.push(label + " ");
    }
    md.push("." + options.language);
    md.push(" .cell-code");
    if (hideCode(cell, options)) {
      md.push(" .hidden");
    }
    if (typeof cell.options[kCellLstCap] === "string") {
      md.push(` caption=\"${cell.options[kCellLstCap]}\"`);
    }
    if (typeof cell.options[kCellFold] !== "undefined") {
      md.push(` fold=\"${cell.options[kCellFold]}\"`);
    }
    if (typeof cell.options[kCellSummary] !== "undefined") {
      md.push(` summary=\"${cell.options[kCellSummary]}\"`);
    }
    md.push("}\n");
    md.push(...mdTrimEmptyLines(cell.source), "\n");
    md.push("```\n");
  }

  // write output if approproate
  if (includeOutput(cell, options)) {
    // compute label prefix for output (in case we need it for files, etc.)
    const labelName = label
      ? label.replace(/^#/, "").replaceAll(":", "-")
      : ("cell-" + (cellIndex + 1));

    // strip spaces, special characters, etc. for latex friendly paths
    const outputName = pandocAutoIdentifier(labelName, true) + "-output";

    let nextOutputSuffix = 1;
    for (
      const { index, output } of (cell.outputs || []).map((value, index) => ({
        index,
        output: value,
      }))
    ) {
      // filter warnings if necessary
      if (
        output.output_type === "stream" &&
        (output as JupyterOutputStream).name === "stderr" &&
        !includeWarnings(cell, options)
      ) {
        continue;
      }

      // leading newline and beginning of div
      md.push("\n::: {");

      // include label/id if appropriate
      const outputLabel = label && labelCellContainer && isDisplayData(output)
        ? (label + "-" + nextOutputSuffix++)
        : label;
      if (outputLabel && shouldLabelOutputContainer(output, options)) {
        md.push(outputLabel + " ");
      }

      // add output class name
      if (output.output_type === "stream") {
        const stream = output as JupyterOutputStream;
        md.push(`.cell-output-${stream.name}`);
      } else {
        md.push(`.${outputTypeCssClass(output.output_type)}`);
      }

      // add hidden if necessary
      if (
        hideOutput(cell, options) ||
        (isWarningOutput(output) && hideWarnings(cell, options))
      ) {
        md.push(` .hidden`);
      }

      md.push("}\n");

      // broadcast figure options
      const figureOptions: JupyterOutputFigureOptions = {};
      const broadcastFigureOption = (
        name:
          | "fig.align"
          | "fig.link"
          | "fig.env"
          | "fig.pos"
          | "fig.scap"
          | "fig.alt",
      ) => {
        const value = cell.options[name];
        if (value) {
          if (Array.isArray(value)) {
            return value[index];
          } else {
            return value;
          }
        } else {
          return null;
        }
      };
      figureOptions[kCellFigAlign] = broadcastFigureOption(kCellFigAlign);
      figureOptions[kCellFigScap] = broadcastFigureOption(kCellFigScap);
      figureOptions[kCellFigLink] = broadcastFigureOption(kCellFigLink);
      figureOptions[kCellFigEnv] = broadcastFigureOption(kCellFigEnv);
      figureOptions[kCellFigPos] = broadcastFigureOption(kCellFigPos);
      figureOptions[kCellFigAlt] = broadcastFigureOption(kCellFigAlt);

      // produce output
      if (output.output_type === "stream") {
        md.push(mdOutputStream(output as JupyterOutputStream));
      } else if (output.output_type === "error") {
        md.push(mdOutputError(output as JupyterOutputError));
      } else if (isDisplayData(output)) {
        const caption = isCaptionableData(output)
          ? (outputCaptions.shift() || null)
          : null;
        md.push(mdOutputDisplayData(
          outputLabel,
          caption,
          outputName + "-" + (index + 1),
          output as JupyterOutputDisplayData,
          options,
          figureOptions,
        ));
        // if this isn't an image and we have a caption, place it at the bottom of the div
        if (caption && !isImage(output, options)) {
          md.push(`\n${caption}\n`);
        }
      } else {
        throw new Error("Unexpected output type " + output.output_type);
      }

      // terminate div
      md.push(`:::\n`);
    }
  }

  // write md w/ div enclosure (if there is any md to write)
  if (md.length > 0) {
    // begin
    md.unshift(divBeginMd);

    // see if there is a cell caption
    if (cellCaption) {
      md.push("\n" + cellCaption + "\n");
    }

    // end div
    md.push(":::\n");

    // lines to next cell
    md.push("\n".repeat((cell.metadata.lines_to_next_cell || 1)));
  }

  return md;
}

function isImage(output: JupyterOutput, options: JupyterToMarkdownOptions) {
  if (isDisplayData(output)) {
    const mimeType = displayDataMimeType(
      output as JupyterOutputDisplayData,
      options,
    );
    if (mimeType) {
      if (displayDataIsImage(mimeType)) {
        return true;
      }
    }
  }
  return false;
}

function mdOutputStream(output: JupyterOutputStream) {
  // trim off warning source line for notebook
  if (output.name === "stderr") {
    if (output.text[0]) {
      const firstLine = output.text[0].replace(
        /<ipython-input.*?>:\d+:\s+/,
        "",
      );
      return mdCodeOutput([firstLine, ...output.text.slice(1)]);
    }
  }

  // normal default handling
  return mdCodeOutput(output.text);
}

function mdOutputError(output: JupyterOutputError) {
  return mdCodeOutput([output.ename + ": " + output.evalue]);
}

function mdOutputDisplayData(
  label: string | null,
  caption: string | null,
  filename: string,
  output: JupyterOutputDisplayData,
  options: JupyterToMarkdownOptions,
  figureOptions: JupyterOutputFigureOptions,
) {
  const mimeType = displayDataMimeType(output, options);
  if (mimeType) {
    if (displayDataIsImage(mimeType)) {
      return mdImageOutput(
        label,
        caption,
        filename,
        mimeType,
        output,
        options,
        figureOptions,
      );
    } else if (displayDataIsMarkdown(mimeType)) {
      return mdMarkdownOutput(output.data[mimeType] as string[]);
    } else if (displayDataIsLatex(mimeType)) {
      return mdLatexOutput(output.data[mimeType] as string[]);
    } else if (displayDataIsHtml(mimeType)) {
      return mdHtmlOutput(output.data[mimeType] as string[]);
    } else if (displayDataIsJson(mimeType)) {
      return mdJsonOutput(
        mimeType,
        output.data[mimeType] as Record<string, unknown>,
      );
    } else if (displayDataIsJavascript(mimeType)) {
      return mdScriptOutput(mimeType, output.data[mimeType] as string[]);
    }
  }

  // no type match found
  return mdWarningOutput(
    "Unable to display output for mime type(s): " +
      Object.keys(output.data).join(", "),
  );
}

function mdImageOutput(
  label: string | null,
  caption: string | null,
  filename: string,
  mimeType: string,
  output: JupyterOutputDisplayData,
  options: JupyterToMarkdownOptions,
  figureOptions: JupyterOutputFigureOptions,
) {
  // alias output properties
  const data = output.data[mimeType] as string[];
  const metadata = output.metadata[mimeType];

  // attributes (e.g. width/height/alt)
  function metadataValue<T>(key: string, defaultValue: T) {
    return metadata && metadata[key] ? metadata["key"] as T : defaultValue;
  }
  let width = metadataValue(kCellOutWidth, 0);
  let height = metadataValue(kCellOutHeight, 0);
  const alt = caption || "";

  // calculate output file name
  const ext = extensionForMimeImageType(mimeType);
  const imageFile = options.assets.figures_dir + "/" + filename + "." + ext;

  // get the data
  const imageText = Array.isArray(data)
    ? (data as string[]).join("")
    : data as string;

  // base64 decode if it's not svg
  const outputFile = join(options.assets.base_dir, imageFile);
  if (mimeType !== kImageSvg) {
    const imageData = base64decode(imageText);

    // if we are in retina mode, then derive width and height from the image
    if (
      mimeType === kImagePng && options.figFormat === "retina" && options.figDpi
    ) {
      const png = new PngImage(imageData);
      if (
        png.dpiX === (options.figDpi * 2) && png.dpiY === (options.figDpi * 2)
      ) {
        width = Math.round(png.width / 2);
        height = Math.round(png.height / 2);
      }
    }
    Deno.writeFileSync(outputFile, imageData);
  } else {
    Deno.writeTextFileSync(outputFile, imageText);
  }

  let image = `![${alt}](${imageFile})`;
  if (label || width || height) {
    image += "{";
    if (label) {
      image += `${label} `;
    }
    if (width) {
      image += `width=${width} `;
    }
    if (height) {
      image += `height=${height} `;
    }
    [kCellFigAlign, kCellFigEnv, kCellFigAlt, kCellFigPos, kCellFigScap]
      .forEach(
        (attrib) => {
          // deno-lint-ignore no-explicit-any
          const value = (figureOptions as any)[attrib];
          if (value) {
            image += `${attrib}='${value}' `;
          }
        },
      );

    image = image.trimRight() + "}";
  }

  // surround with link if we have one
  if (figureOptions[kCellFigLink]) {
    image = `[${image}](${figureOptions[kCellFigLink]})`;
  }

  return mdMarkdownOutput([image]);
}

function mdMarkdownOutput(md: string[]) {
  return md.join("") + "\n";
}

function mdFormatOutput(format: string, source: string[]) {
  return mdEnclosedOutput("```{=" + format + "}", source, "```");
}

function mdLatexOutput(latex: string[]) {
  return mdFormatOutput("tex", latex);
}

function mdHtmlOutput(html: string[]) {
  return mdFormatOutput("html", html);
}

function mdJsonOutput(mimeType: string, json: Record<string, unknown>) {
  return mdScriptOutput(mimeType, [JSON.stringify(json)]);
}

function mdScriptOutput(mimeType: string, script: string[]) {
  const scriptTag = [
    `<script type="${mimeType}">\n`,
    ...script,
    "\n</script>",
  ];
  return mdHtmlOutput(scriptTag);
}

function mdTrimEmptyLines(lines: string[]) {
  // trim leading lines
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty === -1) {
    return [];
  }
  lines = lines.slice(firstNonEmpty);

  // trim trailing lines
  let lastNonEmpty = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      lastNonEmpty = i;
      break;
    }
  }

  if (lastNonEmpty > -1) {
    lines = lines.slice(0, lastNonEmpty + 1);
  }

  return lines;
}

function mdCodeOutput(code: string[]) {
  return mdEnclosedOutput("```", code, "```");
}

function mdEnclosedOutput(begin: string, text: string[], end: string) {
  const output = text.join("");
  const md: string[] = [
    begin + "\n",
    output + (output.endsWith("\n") ? "" : "\n"),
    end + "\n",
  ];
  return md.join("");
}

function mdWarningOutput(msg: string) {
  return mdOutputStream({
    output_type: "stream",
    name: "stderr",
    text: [msg],
  });
}

function isWarningOutput(output: JupyterOutput) {
  if (output.output_type === "stream") {
    const stream = output as JupyterOutputStream;
    return stream.name === "stderr";
  } else {
    return false;
  }
}

function outputTypeCssClass(output_type: string) {
  if (["display_data", "execute_result"].includes(output_type)) {
    output_type = "display";
  }
  return `cell-output-${output_type}`;
}
