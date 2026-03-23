import React, {useMemo, useState} from "react";
import {Button, ButtonGroup, Menu, MenuDivider, MenuItem, Popover, InputGroup, Tag, Spinner} from "@blueprintjs/core";
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
    versions, creating, loading, restoreLoading, switching, createSnapshot, requestSwitch, renameSnapshot, deleteSnapshot, openPanel,
    hasUnsavedChanges, confirmSwitchTarget, confirmSwitchCancel, confirmSwitchProceed, confirmSwitchCreateAndSwitch
  } = useSnapshots();

  const recent = useMemo(() => versions, [versions]);
  const [open, setOpen] = useState(false);

  return (
    <div className={styles["toolbar"]}>
      <div className={styles["toolbarPrimaryRow"]}>
        <ButtonGroup variant={"minimal"}>
          <Button icon="camera" text="Snapshot" intent={hasUnsavedChanges ? "warning" : "success"} loading={creating} disabled={switching} onClick={()=>createSnapshot()} />
          <Popover content={<RecentMenu versions={recent} onSwitch={requestSwitch} onRename={renameSnapshot} onDelete={deleteSnapshot} openPanel={openPanel} />} placement="bottom-start" usePortal={false} isOpen={open} onInteraction={(next)=>setOpen(next)}>
            <Button endIcon={hasUnsavedChanges ? "warning-sign" : "caret-down"} intent={hasUnsavedChanges ? "warning" : "primary"} icon="time" text="Recent" disabled={switching} onClick={()=>setOpen(!open)} />
          </Popover>
          <Button icon="history" onClick={openPanel} intent="primary" text="Timeline" disabled={switching} />
        </ButtonGroup>
        {(creating || switching || restoreLoading || (loading && versions.length === 0)) && (
          <div className={styles["statusPill"]} role="status" aria-live="polite">
            <Spinner size={14} />
            <span>
              {creating ? "Saving snapshot…" : (switching || restoreLoading) ? "Switching snapshot…" : "Loading snapshots…"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SnapshotToolbarActions;
