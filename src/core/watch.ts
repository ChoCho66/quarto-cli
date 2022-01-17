/*
* watch.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { existsSync } from "fs/mod.ts";
import { error } from "log/mod.ts";

import { sleep } from "./async.ts";

export interface PollingFsWatcher extends AsyncIterable<Deno.FsEvent> {
  [Symbol.asyncIterator](): AsyncIterableIterator<Deno.FsEvent>;
}

// Poll the passed files and return FsEvent:
//
// create - occurs if a not previously seen file enters the
//          list returned by files() callback
// modify - occurs if the last modified date changes on
//          a previously seen file
export function watchForFileChanges(
  files: string[] | (() => string[]),
  pollingInterval = 100,
): PollingFsWatcher {
  // function to resolve list of files to watch
  const fileList = () => {
    if (Array.isArray(files)) {
      return files;
    } else {
      return files();
    }
  };

  // inialize last modified times at startup
  const lastModified = new Map<string, Date | null>();
  fileList().forEach((file) =>
    lastModified.set(file, existsSync(file) ? Deno.statSync(file).mtime : null)
  );

  return {
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          // wait the polling interval
          await sleep(pollingInterval);

          // lists of changed files
          const created: string[] = [];
          const modified: string[] = [];

          // examine each file in the list for changes
          const currentFiles = fileList();
          for (let i = 0; i < currentFiles.length; i++) {
            const file = currentFiles[i];
            if (existsSync(file)) {
              // get prev mod (if any)
              const prevMod = lastModified.get(file);
              // read/update last mod
              const lastMod = Deno.statSync(file).mtime;
              lastModified.set(file, lastMod);
              // check for changes
              if (!prevMod) {
                // create
                created.push(file);
              } else if (lastMod?.getTime() !== prevMod?.getTime()) {
                // modify
                modified.push(file);
              }
            }
          }

          // yield events
          if (created.length > 0) {
            yield {
              kind: "create",
              paths: created,
            };
          }
          if (modified.length > 0) {
            yield {
              kind: "modify",
              paths: modified,
            };
          }
        }
      } catch (err) {
        error(
          "Unexpected error while scanning for file changes: " + err.message,
        );
      }
    },
  };
}
