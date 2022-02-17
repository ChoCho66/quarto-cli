/*
* process.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { MuxAsyncIterator, pooledMap } from "async/mod.ts";
import { iterateReader } from "streams/mod.ts";
import { info } from "log/mod.ts";
import { removeIfExists } from "./path.ts";

export interface ProcessResult {
  success: boolean;
  code: number;
  stdout?: string;
  stderr?: string;
}

export async function execProcess(
  options: Deno.RunOptions,
  stdin?: string,
  mergeOutput?: "stderr>stdout" | "stdout>stderr",
  stderrFilter?: (output: string) => string,
): Promise<ProcessResult> {
  // define process
  try {
    // If the caller asked for stdout/stderr to be directed to the rid of an open
    // file, just allow that to happen. Otherwise, specify piped and we will implement
    // the proper behavior for inherit, etc....
    const process = Deno.run({
      ...options,
      stdin: stdin !== undefined ? "piped" : options.stdin,
      stdout: typeof (options.stdout) === "number" ? options.stdout : "piped",
      stderr: typeof (options.stderr) === "number" ? options.stderr : "piped",
    });

    if (stdin !== undefined) {
      if (!process.stdin) {
        throw new Error("Process stdin not available");
      }
      // write in 4k chunks (deno observed to overflow at > 64k)
      const kWindowSize = 4096;
      const buffer = new TextEncoder().encode(stdin);
      let offset = 0;
      while (offset < buffer.length) {
        const end = Math.min(offset + kWindowSize, buffer.length);
        const window = buffer.subarray(offset, end);
        const written = await process.stdin.write(window);
        offset += written;
      }
      process.stdin.close();
    }

    let stdoutText = "";
    let stderrText = "";

    // If the caller requests, merge the output into a single stream. This single stream will
    // follow the runoption for that stream (e.g. inherit, pipe, etc...)
    if (mergeOutput) {
      // This multiplexer that holds the async streams and merges their results
      const multiplexIterator = new MuxAsyncIterator<
        Uint8Array
      >();

      // Add streams to the multiplexer
      const addStream = (
        stream: (Deno.Reader & Deno.Closer) | null,
        filter?: (output: string) => string,
      ) => {
        if (stream !== null) {
          const streamIter = filter
            ? filteredAsyncIterator(iterateReader(stream), filter)
            : iterateReader(stream);
          multiplexIterator.add(streamIter);
        }
      };
      addStream(process.stdout);
      addStream(process.stderr, stderrFilter);

      // Process the output
      const allOutput = await processOutput(
        multiplexIterator,
        mergeOutput === "stderr>stdout" ? options.stdout : options.stderr,
      );

      // Provide the output in whichever result the user requested
      if (mergeOutput === "stderr>stdout") {
        stdoutText = allOutput;
      } else {
        stderrText = allOutput;
      }

      // Close the streams
      const closeStream = (stream: (Deno.Reader & Deno.Closer) | null) => {
        if (stream) {
          stream.close();
        }
      };
      closeStream(process.stdout);
      closeStream(process.stderr);
    } else {
      // Process the streams independently
      if (process.stdout !== null) {
        stdoutText = await processOutput(
          iterateReader(process.stdout),
          options.stdout,
        );
        process.stdout.close();
      }

      if (process.stderr != null) {
        const iterator = stderrFilter
          ? filteredAsyncIterator(iterateReader(process.stderr), stderrFilter)
          : iterateReader(process.stderr);
        stderrText = await processOutput(
          iterator,
          options.stderr,
        );
        process.stderr.close();
      }
    }

    // await result
    const status = await process.status();

    // close the process
    process.close();

    return {
      success: status.success,
      code: status.code,
      stdout: stdoutText,
      stderr: stderrText,
    };
  } catch (e) {
    throw new Error(`Error executing '${options.cmd[0]}': ${e.message}`);
  }
}

export function processSuccessResult(): ProcessResult {
  return {
    success: true,
    code: 0,
  };
}

function filteredAsyncIterator(
  iterator: AsyncIterableIterator<Uint8Array>,
  filter: (output: string) => string,
): AsyncIterableIterator<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return pooledMap(1, iterator, (data: Uint8Array) => {
    return Promise.resolve(
      encoder.encode(filter(decoder.decode(data))),
    );
  });
}

// Processes ouptut from an interator (stderr, stdout, etc...)
async function processOutput(
  iterator: AsyncIterable<Uint8Array>,
  output?: "piped" | "inherit" | "null" | number,
): Promise<string> {
  const decoder = new TextDecoder();
  let outputText = "";
  for await (const chunk of iterator) {
    if (output === "inherit" || output === undefined) {
      info(decoder.decode(chunk), { newline: false });
    }
    const text = decoder.decode(chunk);
    outputText += text;
  }
  return outputText;
}

// Execute a program on Windows by writing command line
// to a tempfile and execute the file with CMD
export async function safeWindowsExec(
  program: string,
  args: string[],
  fnExec: (cmdExec: string[]) => Promise<ProcessResult>,
) {
  const tempFile = Deno.makeTempFileSync(
    { prefix: "quarto-safe-exec", suffix: ".bat" },
  );
  try {
    Deno.writeTextFileSync(tempFile, [program, ...args].join(" ") + "\n");
    return await fnExec(["cmd", "/c", tempFile]);
  } finally {
    removeIfExists(tempFile);
  }
}
