import { dump } from 'js-yaml';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import * as Modal from 'react-modal';
import { useDispatch } from 'react-redux';
import {
  ActionGroup,
  Alert,
  Button,
  Form,
  FormGroup,
  HelperText,
  HelperTextItem,
  Spinner,
  Text,
  Title,
} from '@patternfly/react-core';

import { AttachmentTypes } from '../attachments';
import { attachmentAdd } from '../redux-actions';
import IntegerInput from './IntegerInput';

const DEFAULT_MAX_EVENTS = 10;

type Props = {
  isOpen: boolean;
  kind: string;
  name: string;
  namespace: string;
  onClose: () => void;
  uid: string;
};

const AttachEventsModal: React.FC<Props> = ({ isOpen, kind, name, namespace, onClose, uid }) => {
  const { t } = useTranslation('plugin__lightspeed-console-plugin');

  const dispatch = useDispatch();

  const [error, setError] = React.useState<string>();
  const [events, setEvents] = React.useState([]);
  const [inputNumEvents, setInputNumEvents] = React.useState<number>();
  const [isLoading, setIsLoading] = React.useState(true);

  const numEvents = inputNumEvents ?? Math.min(events.length, DEFAULT_MAX_EVENTS);

  React.useEffect(() => {
    if (kind && name && namespace) {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${protocol}://${window.location.host}/api/kubernetes/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.kind=${kind},involvedObject.name=${name},involvedObject.uid=${uid}&watch=true`;
      const socket = new WebSocket(url);

      socket.onopen = () => {
        setIsLoading(true);
        // After a while, timeout and assume that there are no events
        setTimeout(() => setIsLoading(false), 10000);
      };

      socket.onmessage = (e) => {
        setIsLoading(false);
        const data = JSON.parse(e.data);
        if (data && data.type === 'ADDED') {
          // We ignore the managedFields section because it doesn't have much value
          delete data.object.metadata.managedFields;
          setEvents((oldEvents) => [...oldEvents, data.object]);
        }
      };

      socket.onerror = () => {
        setIsLoading(false);
        setError(t('Error loading events from WebSocket'));
      };

      return () => {
        setIsLoading(false);
        socket.close();
      };
    }
  }, [kind, name, namespace, t, uid]);

  const onSubmit = React.useCallback(
    (e) => {
      e.preventDefault();

      const yaml = dump(events.slice(-numEvents), { lineWidth: -1 }).trim();
      dispatch(
        attachmentAdd(AttachmentTypes.Events, kind, name, namespace, yaml, {
          owner: name,
          lines: numEvents,
        }),
      );
      onClose();
    },
    [dispatch, events, kind, name, namespace, numEvents, onClose],
  );

  return (
    <Modal
      ariaHideApp={false}
      className="modal-dialog"
      isOpen={isOpen}
      onRequestClose={onClose}
      overlayClassName="co-overlay"
    >
      <div className="modal-header">
        <Title headingLevel="h2">{t('Configure events attachment')}</Title>
        <Text>
          {t(
            'You can specify the most recent number of events from this resource to include as an attachment for detailed troubleshooting and analysis.',
          )}
        </Text>
      </div>
      <div className="modal-body">
        <div className="modal-body-content">
          <Form>
            <FormGroup isRequired label={t('Number of events (most recent)')}>
              {isLoading && <Spinner size="md" />}
              {!isLoading &&
                (events.length === 0 ? (
                  <HelperText>
                    <HelperTextItem variant="indeterminate">{t('No events')}</HelperTextItem>
                  </HelperText>
                ) : (
                  <IntegerInput
                    max={events.length}
                    setValue={setInputNumEvents}
                    value={numEvents}
                  />
                ))}
            </FormGroup>
            <ActionGroup>
              <Button isDisabled={numEvents < 1} onClick={onSubmit} type="submit" variant="primary">
                {t('Attach')}
              </Button>
              <Button onClick={onClose} type="submit" variant="link">
                {t('Cancel')}
              </Button>
            </ActionGroup>
            {error && (
              <Alert
                className="ols-plugin__alert"
                isInline
                title={t('Failed to attach context')}
                variant="danger"
              >
                {error}
              </Alert>
            )}
          </Form>
        </div>
      </div>
    </Modal>
  );
};

export default AttachEventsModal;