import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Popconfirm, Spin, message } from 'antd';
import { t, getLang } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { renderMarkdown } from '../../utils/markdown';
import styles from './CustomUltraplanEditModal.module.css';

export default function CustomUltraplanEditModal({ open, initial, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [docHtml, setDocHtml] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  const docRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTitle(initial?.title || '');
      // 新建时预填示例模板供"抄作业并优化";编辑已有专家(有 id)保留其原内容。
      setContent(initial?.id ? (initial.content || '') : t('ui.ultraplan.customContentTemplate'));
    }
  }, [open, initial]);

  // 左栏:用与 ConceptHelp 相同的 /api/concept 请求(此处内联),把使用说明文档常驻显示供"抄作业"。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDocHtml('');
    setDocLoading(true);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/concept?lang=${getLang()}&doc=CustomUltraplanExpert`));
        const md = res.ok ? await res.text() : '';
        if (!cancelled) setDocHtml(md ? renderMarkdown(md) : '');
      } catch (_) {
        if (!cancelled) setDocHtml('');
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // 依赖 getLang():弹窗开着时切换语言需重新拉对应语种文档(切语言不刷新页面)。
  }, [open, getLang()]);

  // 文档渲染后,给每个代码块右上角加"复制"按钮(包一层相对定位容器避免随横向滚动跑掉)。
  useEffect(() => {
    const root = docRef.current;
    if (!root || !docHtml) return;
    const cleanups = [];
    root.querySelectorAll('pre').forEach((pre) => {
      // mermaid 代码块会被全局 observer 异步 replaceWith 成图,跳过以免复制按钮被孤立。
      if (pre.querySelector('code.language-mermaid')) return;
      if (pre.dataset.copyAttached) return;
      pre.dataset.copyAttached = '1';

      const wrap = document.createElement('div');
      wrap.className = styles.codeWrap;
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = styles.copyBtn;
      btn.textContent = t('ui.copy');
      const onClick = () => {
        const code = pre.querySelector('code');
        const text = (code ? code.textContent : pre.textContent) || '';
        // navigator.clipboard 在非安全上下文(局域网明文 HTTP)为 undefined——此时用 ?.
        // 会让后续 .then 抛未捕获 TypeError(.catch 挂不上),故先判存在再调用。
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(text)
          .then(() => { message.success(t('ui.copySuccess')); })
          .catch(() => {});
      };
      btn.addEventListener('click', onClick);
      wrap.appendChild(btn);
      cleanups.push(() => btn.removeEventListener('click', onClick));
    });
    // 注入的 wrap/button DOM 由 React 在重渲染(docHtml 变化)或卸载(destroyOnClose)时随
    // dangerouslySetInnerHTML 子树整体替换掉,这里只需解绑监听器避免悬挂引用。
    return () => cleanups.forEach((fn) => fn());
  }, [docHtml]);

  const canSave = title.trim().length > 0 && content.trim().length > 0;
  const isEdit = !!initial?.id;

  const handleSave = () => {
    if (!canSave) return;
    const id = isEdit ? initial.id : `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onSave({ id, title: title.trim(), content: content.trim() });
  };

  const handleDelete = () => {
    if (!isEdit) return;
    onDelete(initial.id);
  };

  const footer = (
    <div className={styles.footer}>
      <div className={styles.footerLeft}>
        {isEdit && (
          <Popconfirm
            title={t('ui.ultraplan.customDeleteConfirm')}
            okText={t('ui.ultraplan.customDelete')}
            cancelText={t('ui.ultraplan.customCancel')}
            onConfirm={handleDelete}
          >
            <Button danger>{t('ui.ultraplan.customDelete')}</Button>
          </Popconfirm>
        )}
      </div>
      <div className={styles.footerRight}>
        <Button onClick={onClose}>{t('ui.ultraplan.customCancel')}</Button>
        <Button type="primary" disabled={!canSave} onClick={handleSave}>{t('ui.ultraplan.customSave')}</Button>
      </div>
    </div>
  );

  return (
    <Modal
      title={isEdit ? t('ui.ultraplan.customEditTitle') : t('ui.ultraplan.customCreateTitle')}
      open={open}
      onCancel={onClose}
      footer={footer}
      width="min(1100px, calc(100vw - 80px))"
      zIndex={1200}
      destroyOnClose
      styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
    >
      <div className={styles.split}>
        <div className={`chat-md ${styles.docPanel}`} ref={docRef}>
          {docLoading
            ? <div className={styles.docLoading}><Spin /></div>
            : <div dangerouslySetInnerHTML={{ __html: docHtml }} />}
        </div>
        <div className={styles.editPanel}>
          <div className={styles.field}>
            <input
              className={styles.titleInput}
              placeholder={t('ui.ultraplan.customTitlePlaceholder')}
              value={title}
              maxLength={30}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className={styles.fieldGrow}>
            <textarea
              className={styles.contentTextarea}
              placeholder={t('ui.ultraplan.customContentPlaceholder')}
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
