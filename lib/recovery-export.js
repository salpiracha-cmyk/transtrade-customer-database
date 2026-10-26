import fs from 'node:fs/promises';
import path from 'node:path';

// The application's three persistent stores may live outside its release folder.
// Materialize those stores while refusing unrelated external symbolic links.
export async function stageRecovery(appDirectory, destination, progress=()=>{}) {
  const appRoot = await fs.realpath(appDirectory);
  const allowed = [appRoot];
  for (const name of ['data', 'imports', 'uploads']) {
    try { allowed.push(await fs.realpath(path.join(appRoot, name))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const inside = (file, root) => file === root || (!path.relative(root, file).startsWith('..' + path.sep) && path.relative(root, file) !== '..' && !path.isAbsolute(path.relative(root, file)));
  const excluded = relative => {
    const parts = relative.split(path.sep);
    return parts.some(part => ['node_modules', '.git', '.cache'].includes(part)) ||
      parts[0] === 'outputs' || relative === '.env' ||
      (parts[0] === 'data' && /^database(?:\.backup|\.json\.before-)/.test(parts[1] || ''));
  };
  async function copy(source, target, relative, ancestors) {
    if (excluded(relative)) return;
    progress('Copying '+(relative || 'website software and data'));
    const real = await fs.realpath(source);
    if (!allowed.some(root => inside(real, root))) throw Error('Recovery link points outside application storage: ' + relative);
    const stat = await fs.stat(real);
    if (stat.isDirectory()) {
      if (ancestors.has(real)) throw Error('Circular recovery directory: ' + relative);
      const next = new Set(ancestors); next.add(real);
      await fs.mkdir(target, { recursive: true, mode: 0o700 });
      for (const name of await fs.readdir(real)) await copy(path.join(real, name), path.join(target, name), path.join(relative, name), next);
    } else if (stat.isFile()) {
      await fs.copyFile(real, target);
      await fs.chmod(target, stat.mode & 0o777);
    } else {
      throw Error('Unsupported recovery file: ' + relative);
    }
  }
  await copy(appRoot, destination, '', new Set());
}
