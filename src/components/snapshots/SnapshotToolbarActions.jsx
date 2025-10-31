import React, {useMemo, useState} from "react";
import {Button, ButtonGroup, Menu, MenuDivider, MenuItem, Popover, InputGroup, Tag} from "@blueprintjs/core";
import {useSnapshots} from "./SnapshotContext.jsx";
import * as styles from "./snapshots.module.css";

const RecentMenu = ({versions, onSwitch, onRename, onDelete}) => {
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  return (
    <Menu className={styles["timeline-menu"]} data-testid="recent-menu">
      {versions.slice(0, 8).map(v => (
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
                <Button minimal intent="success" icon="tick" onClick={() => { onRename(v.version, renameValue.trim()); setRenameId(null); }}/>
              }/>
            </div>
          ) : (
            <Button minimal icon="edit" text="Rename" onClick={(e)=>{ e.stopPropagation(); setRenameId(v.version); setRenameValue(v.version); }} />
          )}
          <Button data-testid={`snapshot-delete-${v.version}`} minimal icon="trash" intent="danger" text="Delete" onClick={(e)=>{ e.stopPropagation(); onDelete(v.version); }} />
        </MenuItem>
      ))}
      <MenuDivider />
      <MenuItem icon="history" text="Open timeline…" />
    </Menu>
  );
};

export const SnapshotToolbarActions = () => {
  const {versions, creating, loading, createSnapshot, switchTo, renameSnapshot, deleteSnapshot, openPanel} = useSnapshots();

  const recent = useMemo(() => versions, [versions]);
  const [open, setOpen] = useState(false);

  return (
    <div className={styles["toolbar"]}>
      <ButtonGroup minimal>
        <Button icon="camera" text="Snapshot" intent="success" loading={creating || loading} onClick={()=>createSnapshot()} />
        <Popover content={<RecentMenu versions={recent} onSwitch={switchTo} onRename={renameSnapshot} onDelete={deleteSnapshot} />} placement="bottom-start" usePortal={false} isOpen={open} onInteraction={(next)=>setOpen(next)}>
          <Button rightIcon="caret-down" icon="time" text="Recent" onClick={()=>setOpen(!open)} />
        </Popover>
        <Button icon="history" onClick={openPanel} text="Timeline" />
      </ButtonGroup>
    </div>
  );
};

export default SnapshotToolbarActions;
