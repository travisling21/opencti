import { createHash } from 'node:crypto';
import { type ManagerDefinition, registerManager } from './managerModule';
import conf, { booleanConf, logApp } from '../config/conf';
import { executionContext, SYSTEM_USER } from '../utils/access';
import { ES_INDEX_PREFIX } from '../database/utils';
import { elCreateIndex, elIndex, elIndexExists, isAttachmentProcessorEnabled } from '../database/engine';
import { getFileContent } from '../database/raw-file-storage';
import { allFilesForPaths } from '../modules/internal/document/document-domain';
import { getClientBase } from '../database/redis';
import { now } from '../utils/format';
import type { BasicStoreEntityDocument } from '../modules/internal/document/document-types';

// Community-Edition, clean-room document content indexer.
// Reads uploaded files via the public (Apache-licensed) file primitives and
// indexes their extracted text into a dedicated index using the CE engine's
// 'attachment' ingest pipeline. It does NOT use the EE file-search module.

export const INDEX_ARGUS_FILES = `${ES_INDEX_PREFIX}_argus_files`;

const ARGUS_FILE_INDEX_ENABLED = booleanConf('argus_file_index:enabled', true);
const SCHEDULE_TIME = conf.get('argus_file_index:interval') || 60000; // 1 minute
const ARGUS_FILE_INDEX_KEY = conf.get('argus_file_index:lock_key') || 'argus_file_index_manager_lock';
const LAST_RUN_KEY = 'argus:file_index:last_run';
const MAX_FILE_SIZE = conf.get('argus_file_index:max_file_size') || 5_242_880; // 5MB

// Mime types whose text content the ES attachment (Tika) processor can extract.
const INDEXABLE_MIME_PREFIXES = [
  'application/pdf',
  'text/',
  'application/json',
  'application/xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/rtf',
];

const ARGUS_FILES_MAPPING = {
  internal_id: { type: 'keyword' },
  file_id: { type: 'keyword' },
  name: { type: 'text' },
  entity_id: { type: 'keyword' },
  file_markings: { type: 'keyword' },
  indexed_at: { type: 'date' },
  attachment: {
    properties: {
      content: { type: 'text' },
      title: { type: 'text' },
      content_type: { type: 'keyword' },
      language: { type: 'keyword' },
    },
  },
};

let indexEnsured = false;
const ensureIndex = async () => {
  if (indexEnsured) return;
  try {
    const exists = await elIndexExists(INDEX_ARGUS_FILES);
    if (!exists) {
      await elCreateIndex(INDEX_ARGUS_FILES, ARGUS_FILES_MAPPING);
      logApp.info('[ARGUS-FILE-INDEX] Created document content index', { index: INDEX_ARGUS_FILES });
    }
    indexEnsured = true;
  } catch (e) {
    logApp.error('[ARGUS-FILE-INDEX] Failed to ensure index', { cause: e });
  }
};

const fileDocId = (fileId: string) => createHash('sha256').update(fileId).digest('hex');

let shutdown = false;
const argusFileIndexHandler = async () => {
  const context = executionContext('argus_file_index_manager');
  if (!isAttachmentProcessorEnabled()) {
    return; // Tika/ingest-attachment not available on this engine — nothing to do
  }
  await ensureIndex();
  if (!indexEnsured) return;

  try {
    const lastRunRaw = await getClientBase().get(LAST_RUN_KEY);
    const startedAt = now();
    const files: BasicStoreEntityDocument[] = await allFilesForPaths(context, SYSTEM_USER, ['import/'], {
      prefixMimeTypes: INDEXABLE_MIME_PREFIXES,
      maxFileSize: MAX_FILE_SIZE,
      modifiedSince: lastRunRaw || undefined,
      excludedPaths: ['import/pending/'],
    });

    let indexed = 0;
    for (const file of files) {
      if (shutdown) break;
      try {
        const base64 = await getFileContent(file.id, 'base64');
        if (!base64) continue;
        const doc = {
          internal_id: fileDocId(file.id),
          file_id: file.id,
          name: file.name,
          entity_id: file.metaData?.entity_id,
          file_markings: file.metaData?.file_markings ?? [],
          indexed_at: now(),
          file_data: base64,
        };
        await elIndex(INDEX_ARGUS_FILES, doc, { pipeline: 'attachment' });
        indexed += 1;
      } catch (e) {
        logApp.warn('[ARGUS-FILE-INDEX] Failed to index file', { file_id: file.id, cause: e });
      }
    }
    await getClientBase().set(LAST_RUN_KEY, startedAt);
    if (indexed > 0) {
      logApp.info('[ARGUS-FILE-INDEX] Indexed document contents', { count: indexed });
    }
  } catch (e) {
    logApp.error('[ARGUS-FILE-INDEX] Indexing cycle failed', { cause: e });
  }
};

const ARGUS_FILE_INDEX_DEFINITION: ManagerDefinition = {
  id: 'ARGUS_FILE_INDEX_MANAGER',
  label: 'Document content index manager',
  executionContext: 'argus_file_index_manager',
  cronSchedulerHandler: {
    handler: argusFileIndexHandler,
    shutdown: () => { shutdown = true; },
    interval: SCHEDULE_TIME,
    lockKey: ARGUS_FILE_INDEX_KEY,
  },
  enabledByConfig: ARGUS_FILE_INDEX_ENABLED,
  enabledToStart(): boolean {
    return this.enabledByConfig;
  },
  enabled(): boolean {
    return this.enabledByConfig;
  },
};

registerManager(ARGUS_FILE_INDEX_DEFINITION);
