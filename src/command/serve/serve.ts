/*
 * run.ts
 *
 * Copyright (C) 2020-2022 Posit Software, PBC
 */

import { processSuccessResult } from "../../core/process.ts";
import { ProcessResult } from "../../core/process-types.ts";

import { fileExecutionEngine } from "../../execute/engine.ts";
import { RunOptions } from "../../execute/types.ts";

import { render } from "../render/render-shared.ts";
import { renderServices } from "../render/render-services.ts";
import {
  previewURL,
  printBrowsePreviewMessage,
  resolveHostAndPort,
} from "../../core/previewurl.ts";
import { isServerSession } from "../../core/platform.ts";
import { openUrl } from "../../core/shell.ts";

export async function serve(options: RunOptions): Promise<ProcessResult> {
  const { host, port } = await resolveHostAndPort(options);
  const engine = await fileExecutionEngine(options.input);
  if (engine?.run) {
    const target = await engine.target(options.input, options.quiet);
    if (target) {
      const services = renderServices();
      try {
        if (options.render) {
          const result = await render(options.input, {
            services,
            flags: {
              execute: true,
            },
          });
          if (result.error) {
            throw result.error;
          }
        }

        // print message and open browser when ready
        const onReady = async () => {
          printBrowsePreviewMessage(host, port, "");
          if (options.browser && !isServerSession()) {
            await openUrl(previewURL(host, port, ""));
          }
        };

        await engine.run({ ...options, input: options.input, onReady });
        return processSuccessResult();
      } finally {
        services.cleanup();
      }
    }
  }

  return Promise.reject(
    new Error("Unable to run computations for input file"),
  );
}
