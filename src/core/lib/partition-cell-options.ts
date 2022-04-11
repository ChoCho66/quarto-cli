/*
* partition-cell-options.ts
*
* Splits code cell into metadata+options
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

import { Range, rangedLines, RangedSubstring } from "./ranged-text.ts";
import { asMappedString, MappedString, mappedString } from "./mapped-text.ts";
/*import {
  langCommentChars,
  optionCommentPrefix,
  partitionCellOptionsMapped as libPartitionCellOptionsMapped,
} from "./partition-cell-options.ts";*/

import { getEngineOptionsSchema } from "./yaml-schema/chunk-metadata.ts";
import { guessChunkOptionsFormat } from "./guess-chunk-options-format.ts";
import { getYamlIntelligenceResource } from "./yaml-intelligence/resources.ts";
import { ConcreteSchema } from "./yaml-schema/types.ts";
import {
  readAndValidateYamlFromMappedString,
  ValidationError,
} from "./yaml-schema/validated-yaml.ts";
import { readAnnotatedYamlFromMappedString } from "./yaml-intelligence/annotated-yaml.ts";

function mappedSource(
  source: MappedString | string,
  substrs: RangedSubstring[],
) {
  const params: (Range | string)[] = [];
  for (const { range } of substrs) {
    params.push(range);
  }
  return mappedString(source, params);
}

export function partitionCellOptions(
  language: string,
  source: string[],
) {
  const commentChars = langCommentChars(language);
  const optionPrefix = optionCommentPrefix(commentChars[0]);
  const optionSuffix = commentChars[1] || "";

  // find the yaml lines
  const optionsSource: string[] = [];
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
        optionsSource.push(line);
        continue;
      }
    }
    break;
  }

  if (guessChunkOptionsFormat(yamlLines.join("\n")) === "knitr") {
    return {
      yaml: undefined,
      optionsSource,
      source: source.slice(yamlLines.length),
      sourceStartLine: yamlLines.length,
    };
  }

  let yaml;
  if (yamlLines.length > 0) {
    yaml = readAnnotatedYamlFromMappedString(
      asMappedString(yamlLines.join("\n")),
    )!.result;
  }

  return {
    yaml: yaml as Record<string, unknown> | undefined,
    optionsSource,
    source: source.slice(yamlLines.length),
    sourceStartLine: yamlLines.length,
  };
}

export async function parseAndValidateCellOptions(
  mappedYaml: MappedString,
  language: string,
  validate = false,
  engine = "",
) {
  if (mappedYaml.value.trim().length === 0) {
    return undefined;
  }

  const engineOptionsSchema = await getEngineOptionsSchema();
  let schema: ConcreteSchema | undefined = engineOptionsSchema[engine];

  const languages = getYamlIntelligenceResource(
    "handlers/languages.yml",
  ) as string[];

  if (languages.indexOf(language) !== -1) {
    try {
      schema = getYamlIntelligenceResource(
        `handlers/${language}/schema.yml`,
      ) as ConcreteSchema;
    } catch (_e) {
      schema = undefined;
    }
  }

  if (schema === undefined || !validate) {
    return readAnnotatedYamlFromMappedString(mappedYaml)!.result;
  }

  const { yaml, yamlValidationErrors } =
    await readAndValidateYamlFromMappedString(
      mappedYaml,
      schema,
    );

  if (yamlValidationErrors.length > 0) {
    throw new ValidationError(
      `Validation of YAML metadata for cell with engine ${engine} failed`,
      yamlValidationErrors,
    );
  }
  return yaml;
}

/** partitionCellOptionsText splits the a cell code source
 * into:
 * {
 *   yaml: MappedString; // mapped text containing the yaml metadata, without the "//|"" comments
 *   optionsSource: RangedSubstring[]; // the source code of the yaml metadata, including comments
 *   source: MappedString; // the executable source code of the cell itself
 *   sourceStartLine: number; // the index of the line number where the source code of the cell starts
 * }
 */
export function partitionCellOptionsText(
  language: string,
  source: MappedString,
) {
  const commentChars = langCommentChars(language);
  const optionPrefix = optionCommentPrefix(commentChars[0]);
  const optionSuffix = commentChars[1] || "";

  // find the yaml lines
  const optionsSource: RangedSubstring[] = []; // includes comments
  const yamlLines: RangedSubstring[] = []; // strips comments

  let endOfYaml = 0;
  for (const line of rangedLines(source.value, true)) {
    if (line.substring.startsWith(optionPrefix)) {
      if (!optionSuffix || line.substring.trimRight().endsWith(optionSuffix)) {
        let yamlOption = line.substring.substring(optionPrefix.length);
        if (optionSuffix) {
          yamlOption = yamlOption.trimRight();
          yamlOption = yamlOption.substring(
            0,
            yamlOption.length - optionSuffix.length,
          );
        }
        endOfYaml = line.range.start + optionPrefix.length + yamlOption.length -
          optionSuffix.length;
        const rangedYamlOption = {
          substring: yamlOption,
          range: {
            start: line.range.start + optionPrefix.length,
            end: endOfYaml,
          },
        };
        yamlLines.push(rangedYamlOption);
        optionsSource.push(line);
        continue;
      }
    }
    break;
  }

  const mappedYaml = yamlLines.length
    ? mappedSource(source, yamlLines)
    : undefined;

  return {
    // yaml: yaml as Record<string, unknown> | undefined,
    // yamlValidationErrors,
    yaml: mappedYaml,
    optionsSource,
    source: mappedString(source, [{
      start: endOfYaml,
      end: source.value.length,
    }]), // .slice(yamlLines.length),
    sourceStartLine: yamlLines.length,
  };
}

/** NB: this version _does_ parse and validate the YAML source!
 */
export async function partitionCellOptionsMapped(
  language: string,
  outerSource: MappedString,
  validate = false,
  engine = "",
) {
  const {
    yaml: mappedYaml,
    optionsSource,
    source,
    sourceStartLine,
  } = partitionCellOptionsText(language, outerSource);

  if (
    guessChunkOptionsFormat((mappedYaml || asMappedString("")).value) === "yaml"
  ) {
    const yaml = await parseAndValidateCellOptions(
      mappedYaml || asMappedString(""),
      language,
      validate,
      engine,
    );

    return {
      yaml: yaml as Record<string, unknown> | undefined,
      optionsSource,
      source,
      sourceStartLine,
    };
  } else {
    return {
      yaml: undefined,
      optionsSource,
      source,
      sourceStartLine,
    };
  }
}

export function langCommentChars(lang: string): string[] {
  const chars = kLangCommentChars[lang] || "#";
  if (!Array.isArray(chars)) {
    return [chars];
  } else {
    return chars;
  }
}
export function optionCommentPrefix(comment: string) {
  return comment + "| ";
}

// FIXME this is an awkward spot for this particular entry point
export function addLanguageComment(
  language: string,
  comment: string | [string, string],
) {
  kLangCommentChars[language] = comment;
}

export function optionCommentPrefixFromLanguage(language: string) {
  return optionCommentPrefix(langCommentChars(language)[0]);
}

export const kLangCommentChars: Record<string, string | [string, string]> = {
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
  ojs: "//",
};
