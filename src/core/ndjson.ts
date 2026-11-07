/**
 * Incremental NDJSON splitter: feed it text chunks as they arrive, get one callback per
 * complete JSON line. Blank keep-alive lines and unparseable lines are skipped.
 */
export function ndjsonSplitter(onValue: (value: unknown) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          onValue(JSON.parse(line));
        } catch {
          // ignore malformed line
        }
      }
      newline = buffer.indexOf('\n');
    }
  };
}
