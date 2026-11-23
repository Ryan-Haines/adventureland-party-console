import {cp, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {treeBytes, withBuildLock} from '../build-store.ts';

export async function checkBenchmarkSpace(archiveRoot: string, incoming = 0) {
  if (await treeBytes(archiveRoot) + incoming >= 20 * 1024 ** 3)
    throw Error('Benchmark archives would exceed 20 GiB. Move completed archives out of ' + archiveRoot +
      ' before retrying. The current Playwright evidence is in .build/e2e-report and .build/e2e-results.');
}

export async function archiveBenchmarkReports(root: string, archiveRoot: string, destination: string) {
  await withBuildLock(archiveRoot, async () => {
    const directories = ['e2e-report', 'e2e-results'];
    const sizes = await Promise.all(directories.map(directory => treeBytes(path.join(root, '.build', directory))));
    await checkBenchmarkSpace(archiveRoot, sizes[0] + sizes[1]);
    await mkdir(path.join(destination, '.build'), {recursive: true});
    for (const directory of directories)
      await cp(path.join(root, '.build', directory), path.join(destination, '.build', directory), {recursive: true});
  });
}
