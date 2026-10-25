import { isAbsolute, join, relative, resolve } from 'node:path'

export function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

export function isInside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export function rebasePath(value: string, oldBase: string, newBase: string): string {
  return isInside(oldBase, value) ? join(newBase, relative(oldBase, value)) : value
}

export function replacePath(content: string, oldPath: string, newPath: string): string {
  if (!oldPath || samePath(oldPath, newPath)) return content
  const variants: Array<[string, string]> = [
    [oldPath.replace(/\\/g, '/'), newPath.replace(/\\/g, '/')],
    [oldPath, newPath]
  ]
  return variants.reduce((result, [from, to]) => result.split(from).join(to), content)
}

export function pathsChanged(oldRoot: string, newRoot: string, oldHtdocs: string, newHtdocs: string): boolean {
  return !samePath(oldRoot, newRoot) || !samePath(oldHtdocs, newHtdocs)
}
