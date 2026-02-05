import { Map as ImmutableMap } from 'immutable';
import * as React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, CodeBlock, CodeBlockAction, CodeBlockCode, Icon } from '@patternfly/react-core';
import { InfoCircleIcon } from '@patternfly/react-icons';

import { openToolClear } from '../redux-actions';
import { State } from '../redux-reducers';
import CopyAction from './CopyAction';
import Modal from './Modal';

const ToolModal: React.FC = () => {
  const { t } = useTranslation('plugin__lightspeed-console-plugin');

  const dispatch = useDispatch();

  const tool: ImmutableMap<string, unknown> = useSelector((s: State) => {
    const openTool = s.plugins?.ols?.get('openTool');
    return s.plugins?.ols?.getIn([
      'chatHistory',
      openTool.get('chatEntryIndex'),
      'tools',
      openTool.get('id'),
    ]);
  });

  const onClose = React.useCallback(() => {
    dispatch(openToolClear());
  }, [dispatch]);

  if (!tool) {
    return null;
  }
  const { args, content, name, status, has_ui, ui_content } = tool.toJS();

  const argsFormatted = Object.entries(args)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');

  return (
    <Modal
      className="ols-plugin__attachment-modal"
      isOpen={true}
      onClose={onClose}
      title={
        <>
          <Icon status={status === 'error' ? 'danger' : 'info'}>
            <InfoCircleIcon />
          </Icon>{' '}
          {has_ui ? t('Tool interactive UI') : t('Tool output')}
        </>
      }
    >
      {status === 'error' && (
        <Alert
          className="ols-plugin__alert"
          isInline
          title={t('An unexpected error occurred')}
          variant="danger"
        >
          {t('Please retry or contact support if the issue persists.')}
        </Alert>
      )}
      <p>
        {argsFormatted ? (
          <Trans>
            The following output was generated when running{' '}
            <span className="ols-plugin__code-inline">{{ name }}</span> with arguments{' '}
            <span className="ols-plugin__code-inline">{{ argsFormatted }}</span>.
          </Trans>
        ) : (
          <Trans>
            The following output was generated when running{' '}
            <span className="ols-plugin__code-inline">{{ name }}</span> with no arguments.
          </Trans>
        )}
      </p>
      {has_ui && ui_content ? (
        // Display interactive UI in iframe
        <>
          <iframe
            srcDoc={ui_content}
            style={{
              width: '100%',
              height: '500px',
              border: '1px solid var(--pf-t--global--border--color--default)',
              borderRadius: 'var(--pf-t--global--border--radius--small)',
            }}
            title={`${name} UI`}
          />
          {/* Also show raw content as fallback */}
          {content && (
            <details style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
              <summary>{t('Show raw output')}</summary>
              <CodeBlock
                actions={
                  <>
                    <CodeBlockAction />
                    <CodeBlockAction>
                      <CopyAction value={content} />
                    </CodeBlockAction>
                  </>
                }
                className="ols-plugin__code-block ols-plugin__code-block--attachment"
              >
                <CodeBlockCode className="ols-plugin__code-block-code">{content}</CodeBlockCode>
              </CodeBlock>
            </details>
          )}
        </>
      ) : content ? (
        // Display plain text output
        <CodeBlock
          actions={
            <>
              <CodeBlockAction />
              <CodeBlockAction>
                <CopyAction value={content} />
              </CodeBlockAction>
            </>
          }
          className="ols-plugin__code-block ols-plugin__code-block--attachment"
        >
          <CodeBlockCode className="ols-plugin__code-block-code">{content}</CodeBlockCode>
        </CodeBlock>
      ) : (
        <Alert
          className="ols-plugin__alert"
          isInline
          title={t('No output returned')}
          variant="info"
        />
      )}
    </Modal>
  );
};

export default ToolModal;
