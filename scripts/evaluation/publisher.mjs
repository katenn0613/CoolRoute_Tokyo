import {
  access,
  mkdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function publishFilesTransactionally(files, { renameImpl = rename } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new TypeError('发布文件列表不能为空。')
  const transactionId = `${process.pid}-${Date.now()}`
  const entries = files.map(({ path, text }, index) => ({
    path,
    text,
    temporaryPath: `${path}.tmp-${transactionId}-${index}`,
    backupPath: `${path}.bak-${transactionId}-${index}`,
    hadOriginal: false,
    backupCreated: false,
    replacementCreated: false,
  }))

  try {
    for (const entry of entries) {
      await mkdir(dirname(entry.path), { recursive: true })
      await writeFile(entry.temporaryPath, entry.text, 'utf8')
    }
    for (const entry of entries) {
      entry.hadOriginal = await pathExists(entry.path)
      if (entry.hadOriginal) {
        await renameImpl(entry.path, entry.backupPath)
        entry.backupCreated = true
      }
    }
    for (const entry of entries) {
      await renameImpl(entry.temporaryPath, entry.path)
      entry.replacementCreated = true
    }
    await Promise.all(entries.map((entry) => rm(entry.backupPath, { force: true })))
  } catch (error) {
    await Promise.all(entries
      .filter((entry) => entry.replacementCreated)
      .map((entry) => rm(entry.path, { force: true })))
    for (const entry of entries) {
      if (entry.backupCreated && await pathExists(entry.backupPath)) {
        await renameImpl(entry.backupPath, entry.path)
      }
    }
    await Promise.all(entries.flatMap((entry) => [
      rm(entry.temporaryPath, { force: true }),
      rm(entry.backupPath, { force: true }),
    ]))
    throw error
  } finally {
    await Promise.all(entries.map((entry) => rm(entry.temporaryPath, { force: true })))
  }
}
