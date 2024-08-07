import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { consoleFetchText, ResourceIcon } from '@openshift-console/dynamic-plugin-sdk';
import {
  ActionGroup,
  Alert,
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  Form,
  FormGroup,
  MenuToggle,
  Radio,
  Slider,
  SliderOnChangeEvent,
  Spinner,
  Text,
} from '@patternfly/react-core';

import { AttachmentTypes } from '../attachments';
import { useBoolean } from '../hooks/useBoolean';
import { getRequestInitWithAuthHeader } from '../hooks/useAuth';
import { attachmentSet } from '../redux-actions';
import Modal from './Modal';

const DEFAULT_LOG_LINES = 25;
const REQUEST_TIMEOUT = 10 * 60 * 1000; // 10 minutes

type ContainerMenuProps = {
  containers: string[];
  setValue: (string) => void;
  value: string;
};

const ContainerDropdown: React.FC<ContainerMenuProps> = ({ containers, setValue, value }) => {
  const [isOpen, toggleIsOpen, , close] = useBoolean(false);

  const onSelect = React.useCallback(
    (_e: React.MouseEvent<Element, MouseEvent> | undefined, value: string) => {
      close();
      setValue(value);
    },
    [close, setValue],
  );

  return (
    <Dropdown
      isOpen={isOpen}
      onSelect={onSelect}
      toggle={(toggleRef) => (
        <MenuToggle isExpanded={isOpen} onClick={toggleIsOpen} ref={toggleRef}>
          <ResourceIcon kind="Container" /> {value}
        </MenuToggle>
      )}
    >
      <DropdownList>
        {containers.map((container) => (
          <DropdownItem key={container} value={container}>
            <ResourceIcon kind="Container" /> {container}
          </DropdownItem>
        ))}
      </DropdownList>
    </Dropdown>
  );
};

const ContainerRadios: React.FC<ContainerMenuProps> = ({ containers, setValue, value }) => (
  <>
    {containers.map((container) => (
      <Radio
        className="ols-plugin__radio"
        id={container}
        isChecked={container === value}
        isLabelWrapped
        key={container}
        label={
          <>
            <ResourceIcon kind="Container" /> {container}
          </>
        }
        name="container"
        onChange={(_e: React.FormEvent<HTMLInputElement>, isChecked: boolean) => {
          if (isChecked) {
            setValue(container);
          }
        }}
      />
    ))}
  </>
);

const ContainerInput: React.FC<ContainerMenuProps> = ({ containers, setValue, value }) =>
  containers.length < 6 ? (
    <ContainerRadios containers={containers} setValue={setValue} value={value} />
  ) : (
    <ContainerDropdown containers={containers} setValue={setValue} value={value} />
  );

type AttachLogModalProps = {
  containers: string[];
  isOpen: boolean;
  kind: string;
  namespace: string;
  onClose: () => void;
  pod: string;
};

const AttachLogModal: React.FC<AttachLogModalProps> = ({
  containers,
  isOpen,
  namespace,
  onClose,
  pod,
}) => {
  const { t } = useTranslation('plugin__lightspeed-console-plugin');

  const dispatch = useDispatch();

  const defaultContainer = containers?.[0];

  const [container, setContainer] = React.useState<string>(defaultContainer);
  const [error, setError] = React.useState<string>();
  const [isLoading, setIsLoading] = React.useState(false);
  const [lines, setLines] = React.useState<number>(DEFAULT_LOG_LINES);

  React.useEffect(() => {
    if (defaultContainer && container === undefined) {
      setContainer(defaultContainer);
    }
    // Only trigger when the default container changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultContainer]);

  const onLinesChange = React.useCallback(
    (_e: SliderOnChangeEvent, value: number) => setLines(value),
    [],
  );

  const onSubmit = React.useCallback(
    (e) => {
      e.preventDefault();

      setIsLoading(true);
      const url = `/api/kubernetes/api/v1/namespaces/${namespace}/pods/${pod}/log?container=${container}&tailLines=${lines}`;
      consoleFetchText(url, getRequestInitWithAuthHeader(), REQUEST_TIMEOUT)
        .then((response: string) => {
          setIsLoading(false);
          dispatch(
            attachmentSet(
              AttachmentTypes.Log,
              'Container',
              container,
              namespace,
              `Most recent lines from the log for Container '${container}', belonging to pod '${pod}':\n\n${response?.trim()}`,
            ),
          );
          onClose();
        })
        .catch((error) => {
          setIsLoading(false);
          setError(error.message || t('Failed to fetch logs'));
        });
    },
    [container, dispatch, lines, namespace, onClose, pod, t],
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('Configure log attachment')}>
      <Text>
        {t(
          'You can select a container and specify the most recent number of lines of its log file to include as an attachment for detailed troubleshooting and analysis.',
        )}
      </Text>
      <Form>
        <FormGroup isRequired label="Container">
          <ContainerInput containers={containers} setValue={setContainer} value={container} />
        </FormGroup>
        <FormGroup isRequired label={t('Number of lines (most recent)')}>
          <Slider hasTooltipOverThumb max={100} min={1} onChange={onLinesChange} value={lines} />
        </FormGroup>
        <ActionGroup>
          <Button onClick={onSubmit} type="submit" variant="primary">
            {t('Attach')}
          </Button>
          <Button onClick={onClose} type="submit" variant="link">
            {t('Cancel')}
          </Button>
        </ActionGroup>
        {isLoading && <Spinner size="md" />}
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
    </Modal>
  );
};

export default AttachLogModal;
