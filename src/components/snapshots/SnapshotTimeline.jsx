import React, {useState} from "react";
import {Button, ButtonGroup, Card, Icon, Tag} from "@blueprintjs/core";
import * as styles from "./snapshots.module.css";

const SnapshotItem = ({item, isCurrent, onSwitch, onRename, onDelete}) => {
  const [rename, setRename] = useState(false);
  const [val, setVal] = useState(item.version);
  return (
    <Card interactive className={styles["timeline-item"]}>
      <div className={styles["timeline-head"]}>
        <div className={styles["title"]}>
          <Icon icon="git-commit" />
          <span>{item.version}</span>
          {isCurrent ? <Tag minimal intent="primary" round className={styles["space-left"]}>current</Tag> : null}
        </div>
        <div className={styles["meta"]}>
          {item.prev ? <Tag minimal>from {item.prev}</Tag> : null}
          <Tag minimal>{new Date(item.date).toLocaleString()}</Tag>
        </div>
      </div>
      <div className={styles["timeline-actions"]}>
        <ButtonGroup minimal>
          <Button icon="share" text="Switch" intent="primary" onClick={()=>onSwitch(item.version)} />
          {rename ? (
            <>
              <input className={styles["rename-input"]} value={val} onChange={(e)=>setVal(e.target.value)} />
              <Button icon="tick" intent="success" onClick={()=>{ onRename(item.version, val.trim()); setRename(false); }} />
              <Button icon="cross" onClick={()=>setRename(false)} />
            </>
          ) : (
            <Button icon="edit" text="Rename" onClick={()=>setRename(true)} />
          )}
          <Button icon="trash" intent="danger" text="Delete" onClick={()=>onDelete(item.version)} />
        </ButtonGroup>
      </div>
    </Card>
  );
};

const SnapshotTimeline = ({versions, current, onSwitch, onRename, onDelete}) => {
  return (
    <div className={styles["timeline-root"]}>
      {versions.map(v => (
        <SnapshotItem key={v.version} item={v} isCurrent={v.version === current.version} onSwitch={onSwitch} onRename={onRename} onDelete={onDelete} />
      ))}
    </div>
  );
};

export default SnapshotTimeline;
