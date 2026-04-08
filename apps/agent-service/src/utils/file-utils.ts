/**
 * File utilities for agent-service
 * Extracted from web/shared/lib/file-utils.ts
 */

const SESSION_DOCUMENT_FILENAMES = new Set([
  'evaluation.md',
  'history.jsonl',
  'task_plan.md',
  'progress.md',
  'findings.md',
]);

const ROOT_SESSION_DOCUMENT_FILENAMES = new Set([
  'task_plan.md',
  'progress.md',
  'findings.md',
  'history.jsonl',
]);

const TURN_SESSION_DOCUMENT_FILENAMES = new Set([
  'evaluation.md',
  'history.jsonl',
]);

const TASK_ID_PATTERN = /^task_[a-z0-9][a-z0-9_.-]*$/i;
const TURN_ID_PATTERN = /^turn_[a-z0-9][a-z0-9_.-]*$/i;

export function isSessionDocumentFile(filePath?: string): boolean {
  if (!filePath) return false;
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const segments = normalizedPath.split('/').filter(Boolean);
  const filename = segments[segments.length - 1] || '';
  if (!SESSION_DOCUMENT_FILENAMES.has(filename)) return false;

  const sessionsIndex = segments.lastIndexOf('sessions');
  if (sessionsIndex < 0) return false;

  const relativeSegments = segments.slice(sessionsIndex + 1);
  if (relativeSegments.length < 2) return false;

  const taskId = relativeSegments[0];
  if (!TASK_ID_PATTERN.test(taskId)) return false;

  // /sessions/<taskId>/<task_doc>
  if (relativeSegments.length === 2) {
    return ROOT_SESSION_DOCUMENT_FILENAMES.has(relativeSegments[1]);
  }

  // /sessions/<taskId>/interleaved/history.jsonl
  if (relativeSegments.length === 3) {
    return relativeSegments[1] === 'interleaved' && relativeSegments[2] === 'history.jsonl';
  }

  // /sessions/<taskId>/turns/<turnId>/<turn_doc>
  if (relativeSegments.length === 4) {
    return (
      relativeSegments[1] === 'turns' &&
      TURN_ID_PATTERN.test(relativeSegments[2]) &&
      TURN_SESSION_DOCUMENT_FILENAMES.has(relativeSegments[3])
    );
  }

  return false;
}

function isTurnArtifactPath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const segments = normalizedPath.split('/').filter(Boolean);
  const sessionsIndex = segments.lastIndexOf('sessions');
  if (sessionsIndex < 0) return false;

  const relativeSegments = segments.slice(sessionsIndex + 1);
  if (relativeSegments.length < 4) return false;

  const taskId = relativeSegments[0];
  if (!TASK_ID_PATTERN.test(taskId)) return false;

  return (
    relativeSegments[1] === 'turns' &&
    relativeSegments.length >= 4 &&
    TURN_ID_PATTERN.test(relativeSegments[2])
  );
}

interface Artifact {
  id: string;
  name: string;
  path?: string;
  type?: string;
}

export function filterArtifactsForDisplay(artifacts: Artifact[]): Artifact[] {
  const seenPaths = new Set<string>();
  return artifacts.filter((artifact) => {
    const filePath = artifact.path || artifact.name;
    if (!filePath) return false;
    if (seenPaths.has(filePath)) return false;

    // Show canonical turn artifacts plus known session-level documents.
    const isSessionDocument = isSessionDocumentFile(filePath);
    const isCanonical = isTurnArtifactPath(filePath);
    if (!isCanonical && !isSessionDocument) return false;

    seenPaths.add(filePath);
    return true;
  });
}
