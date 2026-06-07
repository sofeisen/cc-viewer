import React, { useState, useEffect, useMemo } from 'react';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { getModelShort, getModelMaxTokens } from '../../utils/helpers';
import { subscribe, getLatest } from '../../utils/workflowStore';
import { TERMINAL_STATES, STATUS_KEYS, fmtDuration, fmtTokens, stateGlyph } from '../../utils/workflowFormat';
import styles from './WorkflowPanel.module.css';

function stateClass(state) {
  if (state === 'done' || state === 'completed') return styles.stateDone;
  if (state === 'failed' || state === 'error') return styles.stateFailed;
  if (state === 'queued') return styles.stateQueued;
  return styles.stateRunning;
}

function barClass(state) {
  if (state === 'done' || state === 'completed') return styles.barDone;
  if (state === 'failed' || state === 'error') return styles.barFailed;
  if (state === 'queued') return styles.barQueued;
  return styles.barRunning;
}

function AgentRow({ agent }) {
  const model = getModelShort(agent.model);
  const is1M = agent.model && getModelMaxTokens(agent.model) >= 1000000;
  const running = !TERMINAL_STATES.has(agent.state);
  const dur = fmtDuration(agent.durationMs);
  // 运行中显示「在干嘛」：最近一次工具名（hover 看摘要）
  const doing = running && agent.lastToolName ? agent.lastToolName : '';
  return (
    <div className={styles.agentRow}>
      <span className={`${styles.stateDot} ${stateClass(agent.state)} ${running ? styles.statePulse : ''}`} title={agent.state}>
        {stateGlyph(agent.state)}
      </span>
      <span className={styles.agentLabel} title={agent.label}>{agent.label || agent.agentType || agent.agentId}</span>
      {doing && <span className={styles.agentDoing} title={agent.lastToolSummary || doing}>{doing}</span>}
      {model && (
        <span className={styles.agentModel}>{model}{is1M ? ' · 1M' : ''}</span>
      )}
      <span className={styles.agentMeta}>
        <span className={styles.metaTok}>{fmtTokens(agent.tokens)} {t('ui.workflow.tok')}</span>
        <span className={styles.metaTool}>{agent.toolCalls} {t('ui.workflow.tools')}</span>
        {dur && <span className={styles.metaDur}>{dur}</span>}
      </span>
    </div>
  );
}

// 时间轴/甘特：每个 agent 一条 startedAt→duration 横条，直观看出并行与长尾瓶颈。
// 运行中的 agent 横条延伸到 now（每秒走）。
function WorkflowTimeline({ data, now }) {
  const agents = (data.agents || []).filter(a => typeof a.startedAt === 'number');
  if (!agents.length) return <div className={styles.notice}>{t('ui.workflow.noTimeline')}</div>;

  const endOf = (a) => a.startedAt + (typeof a.durationMs === 'number' ? a.durationMs : Math.max(0, now - a.startedAt));
  const start = Math.min(...agents.map(a => a.startedAt));
  const end = Math.max(...agents.map(endOf));
  const span = Math.max(1, end - start);
  const sorted = [...agents].sort((x, y) => x.startedAt - y.startedAt);

  return (
    <div className={styles.timeline}>
      {sorted.map((a, i) => {
        const running = !TERMINAL_STATES.has(a.state);
        const aEnd = endOf(a);
        const left = ((a.startedAt - start) / span) * 100;
        const width = Math.max(1.5, ((aEnd - a.startedAt) / span) * 100);
        const d = fmtDuration(a.durationMs ?? Math.max(0, now - a.startedAt));
        return (
          <div key={a.agentId || i} className={styles.ganttRow}>
            <span className={styles.ganttLabel} title={a.label}>{a.label || a.agentType || a.agentId}</span>
            <div className={styles.ganttTrack}>
              <div
                className={`${styles.ganttBar} ${barClass(a.state)} ${running ? styles.statePulse : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${a.label || ''} · ${d}`}
              >
                <span className={styles.ganttDur}>{d}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowBody({ data, view, now }) {
  if (view === 'timeline') return <WorkflowTimeline data={data} now={now} />;
  return <WorkflowList data={data} />;
}

function WorkflowList({ data }) {
  const activePhaseIndex = useMemo(() => {
    const running = (data.agents || []).filter(a => !TERMINAL_STATES.has(a.state) && typeof a.phaseIndex === 'number');
    if (running.length) return Math.max(...running.map(a => a.phaseIndex));
    return null;
  }, [data]);

  const phases = data.phases || [];
  const agents = data.agents || [];

  // 按 phaseIndex 分组；无 phase 的 agent 归到 0 组（少见）。
  const byPhase = useMemo(() => {
    const m = new Map();
    for (const a of agents) {
      const k = typeof a.phaseIndex === 'number' ? a.phaseIndex : 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return m;
  }, [agents]);

  return (
    <div className={styles.body}>
      {phases.length > 0 && (
        <div className={styles.phasesCol}>
          <div className={styles.colTitle}>{t('ui.workflow.phases')}</div>
          {phases.map(p => (
            <div
              key={p.index}
              className={`${styles.phaseItem} ${p.index === activePhaseIndex ? styles.phaseActive : ''}`}
              title={p.detail}
            >
              <span className={styles.phaseIdx}>{p.index}</span>
              <span className={styles.phaseTitle}>{p.title}</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.agentsCol}>
        <div className={styles.colTitle}>{t('ui.workflow.agents', { count: agents.length })}</div>
        {phases.length > 0
          ? phases.map(p => {
              const list = byPhase.get(p.index) || [];
              if (!list.length) return null;
              return (
                <div key={p.index} className={styles.phaseGroup}>
                  <div className={styles.phaseGroupTitle}>{p.title}</div>
                  {list.map((a, i) => <AgentRow key={a.agentId || i} agent={a} />)}
                </div>
              );
            })
          : agents.map((a, i) => <AgentRow key={a.agentId || i} agent={a} />)}
      </div>
    </div>
  );
}

export default function WorkflowPanel({ workflow, resultText, defaultCollapsed }) {
  const runId = workflow?.runId || null;
  const taskId = workflow?.taskId || null;
  const session = workflow?.sessionId || null;
  const project = workflow?.project || null;
  const key = runId || taskId;

  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  const [data, setData] = useState(() => getLatest(key));
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list');  // 'list' | 'timeline'
  const [now, setNow] = useState(() => Date.now());

  // 时间轴模式下、运行中时每秒走一帧，让进行中横条延伸
  useEffect(() => {
    if (view !== 'timeline' || !data?.live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view, data?.live]);

  // REST 首拉
  useEffect(() => {
    if (!session || (!runId && !taskId)) return;
    let alive = true;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    params.set('session', session);
    if (runId) params.set('runId', runId);
    else if (taskId) params.set('taskId', taskId);
    if (project) params.set('project', project);
    fetch(apiUrl(`/api/workflow-journal?${params.toString()}`))
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (j && j.ok && j.data) {
          // 若 SSE 已先送达权威完成快照（live!==true），别用可能滞后的 REST（含运行中）覆盖回退
          setData(prev => (prev && prev.live === false && j.data.live) ? prev : j.data);
        } else setError(true);
      })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, runId, taskId, project]);

  // SSE 实时跟随
  useEffect(() => {
    if (!key) return undefined;
    return subscribe(key, (next) => setData(next));
  }, [key]);

  // 没拿到结构化 id（旧条目）→ 回退纯文本，保持原行为
  if (!session || (!runId && !taskId)) {
    return <pre className={styles.fallback}>{resultText}</pre>;
  }

  const title = data?.workflowName || t('ui.workflow.title');
  const statusLabel = data?.status ? (STATUS_KEYS[data.status] ? t(STATUS_KEYS[data.status]) : data.status) : '';

  return (
    <div className={styles.panel}>
      <div className={styles.header} onClick={() => setCollapsed(c => !c)}>
        <div className={styles.headerMain}>
          <span className={styles.wfName}>{title}</span>
          {data?.summary && <span className={styles.wfSummary}>{data.summary}</span>}
        </div>
        <div className={styles.headerMeta}>
          {data?.live && <span className={`${styles.liveDot} ${styles.statePulse}`} title={statusLabel} />}
          {data && (
            <span className={styles.headerStat}>
              {t('ui.workflow.agentsShort', { count: data.agentCount || 0 })}
              {data.totalTokens ? ` · ${fmtTokens(data.totalTokens)} ${t('ui.workflow.tok')}` : ''}
              {statusLabel ? ` · ${statusLabel}` : ''}
            </span>
          )}
          {data && !collapsed && (
            <span className={styles.viewToggle} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`${styles.viewBtn} ${view === 'list' ? styles.viewBtnActive : ''}`}
                onClick={() => setView('list')}
              >{t('ui.workflow.viewList')}</button>
              <button
                type="button"
                className={`${styles.viewBtn} ${view === 'timeline' ? styles.viewBtnActive : ''}`}
                onClick={() => { setNow(Date.now()); setView('timeline'); }}
              >{t('ui.workflow.viewTimeline')}</button>
            </span>
          )}
          <span className={styles.toggle}>{collapsed ? t('ui.expand') : t('ui.collapse')}</span>
        </div>
      </div>
      {!collapsed && (
        <>
          {error && !data && <div className={styles.notice}>{t('ui.workflow.loadFailed')}</div>}
          {loading && !data && <div className={styles.notice}>{t('ui.workflow.loading')}</div>}
          {data && <WorkflowBody data={data} view={view} now={now} />}
        </>
      )}
    </div>
  );
}
