import * as path from 'path';

/** Quotes one POSIX shell argument, including embedded apostrophes. */
export function quoteShellArgument(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function buildSearchCommand(term: string, directory: string): string {
  return `grep -rnI --exclude-dir=node_modules -e ${quoteShellArgument(term)} -- ${quoteShellArgument(directory)}`;
}

export function buildCompressCommand(directory: string, archive: string, names: string[]): string {
  const targets = names.map(quoteShellArgument).join(' ');
  return `cd ${quoteShellArgument(directory)} && tar -czf ${quoteShellArgument(archive)} -- ${targets}`;
}

export function buildExtractCommand(remotePath: string): string | undefined {
  const name = path.posix.basename(remotePath);
  const directory = quoteShellArgument(path.posix.dirname(remotePath));
  if (remotePath.endsWith('.tar.gz') || remotePath.endsWith('.tgz')) {
    return `cd ${directory} && tar -xzf ${quoteShellArgument(name)}`;
  }
  if (remotePath.endsWith('.zip')) {
    return `cd ${directory} && unzip -o ${quoteShellArgument('./' + name)}`;
  }
  if (remotePath.endsWith('.gz')) {
    return `cd ${directory} && gunzip -k -- ${quoteShellArgument(name)}`;
  }
  return undefined;
}
