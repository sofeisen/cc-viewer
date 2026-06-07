// Workflow run journal route: serve normalized panel data + arm live watch.
import { resolveJournalPath, resolveWorkflowsDir, readNormalizedJournal } from '../lib/workflow-journal.js';
import { armWorkflowWatch } from '../lib/workflow-watcher.js';

function workflowJournal(req, res, parsedUrl, isLocal, deps) {
  try {
    const session = parsedUrl.searchParams.get('session') || '';
    const runId = parsedUrl.searchParams.get('runId') || '';
    const taskId = parsedUrl.searchParams.get('taskId') || '';
    const project = parsedUrl.searchParams.get('project') || undefined;

    if (!session) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'missing session' }));
      return;
    }
    if (!runId && !taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'missing runId or taskId' }));
      return;
    }

    // 惰性 arm：只监视真有人在看的 session workflows 目录，后续 journal 覆写经 SSE 实时推送。
    const wfDir = resolveWorkflowsDir(session, project);
    if (wfDir && deps && Array.isArray(deps.clients)) {
      try {
        armWorkflowWatch({ workflowsDir: wfDir, sessionId: session, project, clients: deps.clients });
      } catch {}
    }

    const journalPath = resolveJournalPath({ sessionId: session, projectHint: project, runId, taskId });
    if (!journalPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    const data = readNormalizedJournal(journalPath);
    if (!data) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unreadable journal' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}

export const workflowJournalRoutes = [
  { method: 'GET', match: 'exact', path: '/api/workflow-journal', handler: workflowJournal },
];
