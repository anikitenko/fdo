import React, {useMemo, useState} from "react";
import {Button, ButtonGroup, Menu, MenuDivider, MenuItem, Popover, InputGroup, Tag, Callout} from "@blueprintjs/core";
import {useSnapshots} from "./SnapshotContext.jsx";
import * as styles from "./snapshots.module.css";

const RecentMenu = ({versions, onSwitch, onRename, onDelete, openPanel}) => {
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  const handleRenameConfirm = (versionId) => {
    onRename(versionId, renameValue.trim());
    setRenameId(null);
  };

  return (
    <Menu className={styles["timeline-menu"]} data-testid="recent-menu">
      {versions.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8).map(v => (
        <MenuItem
          key={v.version}
          text={
            <div className={styles["menu-item-row"]}>
              <span>{v.version}</span>
              {v.current ? <Tag intent="primary" minimal round>current</Tag> : null}
            </div>
          }
          labelElement={<span style={{opacity:0.7}}>{new Date(v.date).toLocaleTimeString()}</span>}
          onClick={() => onSwitch(v.version)}
        >
          {/* Inline actions for better testability and UX */}
          {renameId === v.version ? (
            <div className={styles["rename-inline"]} onClick={(e)=>e.stopPropagation()}>
              <InputGroup autoFocus value={renameValue} onChange={(e)=>setRenameValue(e.target.value)} rightElement={
                <Button variant={"minimal"} intent="success" icon="tick" onClick={() => handleRenameConfirm(v.version)}/>
              }/>
            </div>
          ) : (
            <Button variant={"minimal"} icon="edit" text="Rename" onClick={(e)=>{ e.stopPropagation(); setRenameId(v.version); setRenameValue(v.version); }} />
          )}
          <Button data-testid={`snapshot-delete-${v.version}`} variant={"minimal"} icon="trash" intent="danger" text="Delete" onClick={(e)=>{ e.stopPropagation(); onDelete(v.version); }} />
        </MenuItem>
      ))}
      <MenuDivider />
      <MenuItem icon="history" text="Open timeline…" onClick={openPanel} />
    </Menu>
  );
};

export const SnapshotToolbarActions = () => {
  const {
    versions, creating, loading, createSnapshot, requestSwitch, renameSnapshot, deleteSnapshot, openPanel,
    hasUnsavedChanges, confirmSwitchTarget, confirmSwitchCancel, confirmSwitchProceed, confirmSwitchCreateAndSwitch
  } = useSnapshots();

  const recent = useMemo(() => versions, [versions]);
  const [open, setOpen] = useState(false);

  return (
    <div className={styles["toolbar"]}>
      <ButtonGroup variant={"minimal"}>
        <Button icon="camera" text="Snapshot" intent={hasUnsavedChanges ? "warning" : "success"} loading={creating || loading} onClick={()=>createSnapshot()} />
        <Popover content={<RecentMenu versions={recent} onSwitch={requestSwitch} onRename={renameSnapshot} onDelete={deleteSnapshot} openPanel={openPanel} />} placement="bottom-start" usePortal={false} isOpen={open} onInteraction={(next)=>setOpen(next)}>
          <Button endIcon={hasUnsavedChanges ? "warning-sign" : "caret-down"} intent={hasUnsavedChanges ? "warning" : "primary"} icon="time" text="Recent" onClick={()=>setOpen(!open)} />
        </Popover>
        <Button icon="history" onClick={openPanel} intent="primary" text="Timeline" />
      </ButtonGroup>
      {confirmSwitchTarget && (
        <div className={styles["inline-banner"]} role="region" aria-live="polite">
          <Callout intent="warning" icon="warning-sign" title="You have changes since your last snapshot.">
            <div className={styles["banner-actions"]}>
              <Button size={"small"} intent="success" onClick={confirmSwitchCreateAndSwitch} icon="camera">Create & Switch</Button>
              <Button size={"small"} intent="warning" onClick={confirmSwitchProceed} icon="swap-vertical">Switch Anyway</Button>
              <Button size={"small"} variant={"minimal"} onClick={confirmSwitchCancel}>Dismiss</Button>
            </div>
          </Callout>
        </div>
      )}
    </div>
  );
};

export default SnapshotToolbarActions;
